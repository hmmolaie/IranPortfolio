import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { AssetType, type FinancialStatement } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FINANCIAL_REPORT_TYPE_LABELS_FA, type FinancialReportType } from '@sabadyar/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { safeUploadFileName } from '../funds/extract-report-text';
import { symbolKey } from '../portfolios/stock-signals';
import { extractStatementText, normalizeFa } from './statement-extract';
import { normalizeFigures, normalizeSensitivity, parsePeriodEnd } from './fundamental-score';
import { loadMacroDrivers, type MacroDriver } from './macro-drivers';
import {
  buildFundamentalView,
  loadLatestFundamentalViews,
  loadLatestPrices,
  type FundamentalView,
} from './fundamental-views';

export type { FundamentalView } from './fundamental-views';

/** صورت مالی بلند است و مدل گاهی چند دقیقه طول می‌کشد */
const ANALYSIS_TIMEOUT_MS = 10 * 60_000;
/** اگر با متن کامل time out شد، تلاش دوم با ابتدای متن (صورت‌های اصلی اول می‌آیند) */
const RETRY_TEXT_CHARS = 30_000;
const MIN_TEXT_CHARS = 200;
const REPORT_TYPES = new Set<FinancialReportType>(['annual', 'interim9', 'interim6', 'interim3', 'balance', 'other']);
/** صورت مالی که تازه‌تر از این بارگذاری شده در خبرنامه «تازه» خوانده می‌شود */
const NEW_STATEMENT_DAYS = 7;

type StatementLlmOut = {
  companyFa?: string;
  symbolFa?: string;
  reportType?: string;
  periodEndFa?: string;
  periodMonths?: number | string;
  audited?: boolean | string;
  consolidated?: boolean | string;
  unitFa?: string;
  figures?: Record<string, unknown>;
  sensitivity?: Record<string, unknown>;
  summaryFa?: unknown;
  strengthsFa?: unknown;
  weaknessesFa?: unknown;
  risksFa?: unknown;
  llmScore?: number | string;
};

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) {
    const joined = v.map((x) => String(x ?? '').trim()).filter(Boolean).join('\n');
    return joined || null;
  }
  const s = String(v).trim();
  return s ? s.slice(0, 4000) : null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|بله|1)$/i.test(v.trim())) return true;
    if (/^(false|no|خیر|0)$/i.test(v.trim())) return false;
  }
  return null;
}

/** multer نام فایل را latin1 می‌خواند؛ نام فارسی دوباره utf8 می‌شود */
function uploadName(original: string | undefined): string {
  const raw = original || 'statement';
  if (/[^\u0000-\u00ff]/.test(raw)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? raw : decoded;
}

function isModelTimeout(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /time ?out|aborted due to timeout|TimeoutError/i.test(msg);
}

function reportTypeFrom(raw: unknown, months: number | null): FinancialReportType {
  const s = String(raw ?? '').trim() as FinancialReportType;
  if (REPORT_TYPES.has(s)) return s;
  if (months === 12) return 'annual';
  if (months === 9) return 'interim9';
  if (months === 6) return 'interim6';
  if (months === 3) return 'interim3';
  return 'other';
}

@Injectable()
export class FundamentalsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FundamentalsService.name);
  private readonly queue: string[] = [];
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** آنالیزهایی که با ری‌استارت نیمه‌کاره ماندند دوباره در صف می‌روند */
  async onApplicationBootstrap() {
    try {
      const stale = await this.prisma.financialStatement.findMany({
        where: { analysisStatus: { in: ['pending', 'running'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      for (const row of stale) this.enqueue(row.id);
    } catch (e) {
      this.logger.warn(`بازیابی صف صورت مالی: ${(e as Error).message}`);
    }
  }

  /** فایل را ذخیره و آنالیز را به صف پس‌زمینه می‌سپارد؛ پاسخ فوری است */
  async upload(adminId: string, instrumentId: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('فایل صورت مالی را بفرستید');
    const inst = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { id: true, symbol: true, assetType: true },
    });
    if (!inst) throw new NotFoundException('نماد یافت نشد');
    if (inst.assetType !== AssetType.STOCK) {
      throw new BadRequestException('صورت مالی فقط برای سهم بارگذاری می‌شود');
    }
    const name = uploadName(file.originalname);
    const head = file.buffer.subarray(0, 5).toString('latin1');
    const kind = head.startsWith('%PDF') ? 'pdf' : 'excel';

    const dir = path.join(process.cwd(), 'uploads', 'statements');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeUploadFileName(name));
    await fs.writeFile(filePath, file.buffer);

    const row = await this.prisma.financialStatement.create({
      data: {
        instrumentId: inst.id,
        symbol: inst.symbol,
        uploadedById: adminId,
        fileName: name.slice(0, 200),
        filePath,
        fileKind: kind,
        analysisStatus: 'pending',
      },
    });
    this.enqueue(row.id);
    return this.toAdminRow(row);
  }

  async retry(id: string) {
    const row = await this.prisma.financialStatement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('صورت مالی پیدا نشد');
    if (row.analysisStatus === 'pending' || row.analysisStatus === 'running') return this.toAdminRow(row);
    const updated = await this.prisma.financialStatement.update({
      where: { id },
      data: { analysisStatus: 'pending', analysisError: null },
    });
    this.enqueue(id);
    return this.toAdminRow(updated);
  }

  async remove(id: string) {
    const row = await this.prisma.financialStatement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('صورت مالی پیدا نشد');
    await this.prisma.financialStatement.delete({ where: { id } });
    if (row.filePath) await fs.unlink(row.filePath).catch(() => undefined);
    return { ok: true, id };
  }

  /** صورت‌های مالی یک سهم برای پایین صفحهٔ همان سهم؛ تازه‌ترین دوره اول */
  async listForInstrument(instrumentId: string, isAdmin: boolean) {
    const inst = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { id: true, symbol: true, nameFa: true, assetType: true },
    });
    if (!inst) throw new NotFoundException('نماد یافت نشد');
    if (inst.assetType !== AssetType.STOCK) return { supported: false, items: [], drivers: [] };

    const rows = await this.prisma.financialStatement.findMany({
      where: { instrumentId, ...(isAdmin ? {} : { analysisStatus: 'done' }) },
      orderBy: [{ periodEndKey: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const [price, drivers] = await Promise.all([
      loadLatestPrices(this.prisma, [instrumentId]).then((m) => m.get(instrumentId) ?? null),
      loadMacroDrivers(this.prisma).catch(() => [] as MacroDriver[]),
    ]);
    const latestDoneId = rows.find((r) => r.analysisStatus === 'done')?.id ?? null;
    const items = rows.map((row) => {
      const base = this.toAdminRow(row);
      if (row.analysisStatus !== 'done') return { ...base, isLatest: false, view: null };
      const view = buildFundamentalView(row, inst, price, drivers);
      return { ...base, isLatest: row.id === latestDoneId, view };
    });
    return { supported: true, symbol: inst.symbol, items, drivers };
  }

  /**
   * پیشنهادهای بنیادی: آخرین صورت مالی هر سهم با قیمت روز امتیاز می‌گیرد؛ گزارش قدیمی‌تر کم‌اثرتر است
   * و گزارش خیلی قدیمی در رتبه‌بندی نمی‌آید. کنار آن اثر تغییر یک‌ماههٔ دلار و کالاها.
   */
  async suggestions() {
    const [views, drivers] = await Promise.all([this.latestViews(), loadMacroDrivers(this.prisma).catch(() => [])]);
    const ranked = views
      .filter((v) => !v.score.stale && v.score.effective != null)
      .sort((a, b) => (b.score.effective ?? 0) - (a.score.effective ?? 0));
    const macroRows = views
      .filter((v) => !v.score.stale && v.macro && v.macro.lines.length && Math.abs(v.macro.score) >= 1)
      .sort((a, b) => (b.macro?.score ?? 0) - (a.macro?.score ?? 0));
    return {
      noteFa:
        'امتیاز از آخرین صورت مالی بارگذاری‌شدهٔ هر سهم و آخرین قیمت پایانی حساب می‌شود: ارزش‌گذاری ۳۰، سودآوری ۲۵، رشد ۲۰ و سلامت مالی ۲۵ امتیاز، به‌علاوهٔ نظر مدل. هرچه پایان دورهٔ گزارش قدیمی‌تر باشد امتیاز به ۵۰ نزدیک‌تر می‌شود و گزارش بیش از ۳۰ ماه در فهرست نمی‌آید. این فهرست توصیهٔ خرید نیست.',
      drivers,
      ranked: ranked.slice(0, 60),
      macro: {
        positive: macroRows.filter((v) => (v.macro?.score ?? 0) > 0).slice(0, 25),
        negative: macroRows
          .filter((v) => (v.macro?.score ?? 0) < 0)
          .sort((a, b) => (a.macro?.score ?? 0) - (b.macro?.score ?? 0))
          .slice(0, 25),
      },
      staleCount: views.filter((v) => v.score.stale).length,
    };
  }

  /**
   * بخش خبرنامهٔ تلگرام برای سهم‌های سبد کاربر: امتیاز بنیادی آخرین صورت مالی،
   * اثر تغییر اخیر دلار و کالاها و صورت مالی تازه.
   */
  async holderBriefFa(userId: string): Promise<string | null> {
    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      select: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { items: { where: { assetType: AssetType.STOCK }, select: { symbol: true } } },
        },
      },
    });
    const held = [...new Set(portfolios.flatMap((p) => p.snapshots[0]?.items.map((i) => i.symbol) ?? []))];
    if (!held.length) return null;
    const views = await this.latestViews(held);
    if (!views.length) return null;
    const freshCut = Date.now() - NEW_STATEMENT_DAYS * 86_400_000;
    const fresh = new Set(
      (
        await this.prisma.financialStatement.findMany({
          where: { id: { in: views.map((v) => v.statementId) }, createdAt: { gte: new Date(freshCut) } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 0 });
    const lines: string[] = ['<b>بنیاد سهم‌های سبد شما</b>', 'از آخرین صورت مالی بارگذاری‌شده و تغییر یک‌ماههٔ دلار و کالاها', ''];
    const ordered = [...views].sort((a, b) => Math.abs(b.macro?.score ?? 0) - Math.abs(a.macro?.score ?? 0)).slice(0, 8);
    for (const v of ordered) {
      const head = [`<b>${esc(v.symbol)}</b>`];
      if (v.score.effective != null) head.push(`امتیاز بنیادی ${fa(v.score.effective)} از ۱۰۰`);
      if (v.periodEndFa) head.push(`${esc(v.reportTypeFa)} ${esc(v.periodEndFa)}`);
      if (fresh.has(v.statementId)) head.push('صورت مالی تازه');
      lines.push(head.join(' — '));
      if (v.macro?.summaryFa && Math.abs(v.macro.score) >= 3) lines.push(esc(v.macro.summaryFa));
      else if (v.score.reasonsFa[0]) lines.push(esc(v.score.reasonsFa.slice(0, 2).join('، ')));
      if (v.score.stale) lines.push('این گزارش قدیمی است و اثرش کم در نظر گرفته شد.');
      lines.push('');
    }
    lines.push('این بخش تحلیل خودکار صورت مالی است و توصیهٔ خرید یا فروش نیست.');
    const text = lines.join('\n').trim();
    return text.length > 3900 ? `${text.slice(0, 3890)}…` : text;
  }

  // ---------------------------------------------------------------- داخلی

  private latestViews(symbols?: string[]): Promise<FundamentalView[]> {
    return loadLatestFundamentalViews(this.prisma, symbols);
  }

  private toAdminRow(row: FinancialStatement) {
    const type = (row.reportType ?? null) as FinancialReportType | null;
    const json = (row.analysisJson ?? {}) as { mismatchFa?: string; companyFa?: string; unitFa?: string };
    return {
      id: row.id,
      fileName: row.fileName,
      fileKind: row.fileKind,
      reportType: row.reportType,
      reportTypeFa: type ? FINANCIAL_REPORT_TYPE_LABELS_FA[type] ?? null : null,
      periodEndFa: row.periodEndFa,
      periodMonths: row.periodMonths,
      audited: row.audited,
      consolidated: row.consolidated,
      summaryFa: row.summaryFa,
      strengthsFa: row.strengthsFa,
      weaknessesFa: row.weaknessesFa,
      risksFa: row.risksFa,
      llmScore: row.llmScore,
      companyFa: json.companyFa ?? null,
      mismatchFa: json.mismatchFa ?? null,
      analysisStatus: row.analysisStatus,
      analysisError: row.analysisError,
      createdAt: row.createdAt,
    };
  }

  private enqueue(id: string) {
    if (!this.queue.includes(id)) this.queue.push(id);
    void this.drainQueue();
  }

  /** صورت‌های مالی یکی‌یکی آنالیز می‌شوند */
  private async drainQueue() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const id = this.queue.shift();
        if (!id) break;
        await this.process(id).catch((e) => this.logger.error(`آنالیز صورت مالی ${id}: ${(e as Error).message}`));
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(id: string) {
    let row = await this.prisma.financialStatement.findUnique({
      where: { id },
      include: { instrument: { select: { symbol: true, nameFa: true } } },
    });
    if (!row || row.analysisStatus === 'done') return;
    await this.prisma.financialStatement.update({ where: { id }, data: { analysisStatus: 'running' } });
    try {
      if (!row.extractedText) {
        const buffer = await fs.readFile(row.filePath);
        const { kind, text } = await extractStatementText(buffer, row.fileName);
        if (text.trim().length < MIN_TEXT_CHARS) {
          throw new Error('متن قابل خواندنی در فایل نبود؛ احتمالاً PDF اسکن‌شده است. نسخهٔ اکسل کدال را بارگذاری کنید.');
        }
        row = await this.prisma.financialStatement.update({
          where: { id },
          data: { extractedText: text, fileKind: kind },
          include: { instrument: { select: { symbol: true, nameFa: true } } },
        });
      }
      const text = row.extractedText ?? '';
      let out: StatementLlmOut;
      try {
        out = await this.runAnalysis(row.uploadedById ?? undefined, row.instrument, row.fileKind, text);
      } catch (e) {
        if (!isModelTimeout(e) || text.length <= RETRY_TEXT_CHARS) throw e;
        this.logger.warn(`آنالیز صورت مالی ${id}: time out؛ تلاش دوباره با متن کوتاه‌تر`);
        out = await this.runAnalysis(
          row.uploadedById ?? undefined,
          row.instrument,
          row.fileKind,
          `${text.slice(0, RETRY_TEXT_CHARS)}\n… [بقیهٔ متن برای کوتاهی حذف شد]`,
        );
      }

      const still = await this.prisma.financialStatement.findUnique({ where: { id }, select: { id: true } });
      if (!still) return;

      const figures = normalizeFigures(out.figures);
      if (!Object.keys(figures).length) throw new Error('مدل هیچ رقمی از صورت مالی استخراج نکرد');
      const months = Number(out.periodMonths);
      const periodMonths = Number.isFinite(months) && months >= 1 && months <= 24 ? Math.round(months) : null;
      const end = parsePeriodEnd(out.periodEndFa);
      const llmScore = Number(out.llmScore);
      const claimed = out.symbolFa ? symbolKey(normalizeFa(String(out.symbolFa))) : '';
      const mismatchFa =
        claimed && claimed !== symbolKey(row.instrument.symbol)
          ? `نماد داخل فایل «${out.symbolFa}» است ولی برای «${row.instrument.symbol}» بارگذاری شده.`
          : null;

      await this.prisma.financialStatement.update({
        where: { id },
        data: {
          reportType: reportTypeFrom(out.reportType, periodMonths),
          periodEndFa: end ? `${end.jy}/${String(end.jm).padStart(2, '0')}/${String(end.jd).padStart(2, '0')}` : null,
          periodEndKey: end?.key ?? null,
          periodMonths,
          audited: asBool(out.audited),
          consolidated: asBool(out.consolidated),
          figures: figures as object,
          sensitivity: normalizeSensitivity(out.sensitivity) as object,
          summaryFa: asText(out.summaryFa),
          strengthsFa: asText(out.strengthsFa),
          weaknessesFa: asText(out.weaknessesFa),
          risksFa: asText(out.risksFa),
          llmScore: Number.isFinite(llmScore) ? Math.max(0, Math.min(10, Math.round(llmScore * 10) / 10)) : null,
          analysisJson: {
            companyFa: asText(out.companyFa),
            symbolFa: asText(out.symbolFa),
            unitFa: asText(out.unitFa),
            mismatchFa,
          },
          analysisStatus: 'done',
          analysisError: null,
        },
      });
    } catch (e) {
      const message = (e as Error).message?.slice(0, 1000) || 'خطای نامشخص';
      this.logger.warn(`آنالیز صورت مالی ${id} ناموفق: ${message}`);
      await this.prisma.financialStatement
        .update({ where: { id }, data: { analysisStatus: 'failed', analysisError: message } })
        .catch(() => undefined);
    }
  }

  private async runAnalysis(
    userId: string | undefined,
    inst: { symbol: string; nameFa: string },
    kind: string,
    text: string,
  ): Promise<StatementLlmOut> {
    const system = await this.llm.getSystemPrompt(userId, 'financial_statement_analysis');
    const pdfNote =
      kind === 'pdf'
        ? 'خط‌های PDF از روی جای متن ساخته شده‌اند و ستون‌ها با | جدا هستند (برچسب، دورهٔ جاری، دورهٔ قبل، ...، درصد تغییر). عددی که با ؟ تمام شده ممکن است ترتیب گروه‌های سه‌رقمی‌اش جابه‌جا باشد؛ اگر با جمع‌ها یا درصد تغییر جور نیست، به آن تکیه نکن.'
        : 'ورودی جدول‌های اکسل کدال است و ستون‌ها با | جدا هستند.';
    const out = await this.llm.chatJson<StatementLlmOut>(
      'financial_statement_analysis',
      system,
      `نماد: ${inst.symbol}
نام شرکت در سامانه: ${inst.nameFa}
نوع فایل: ${kind}
${pdfNote}

متن صورت مالی:
${text}`,
      userId,
      { timeoutMs: ANALYSIS_TIMEOUT_MS },
    );
    if (!out || typeof out !== 'object') throw new Error('پاسخ مدل JSON معتبر نبود');
    return out;
  }
}
