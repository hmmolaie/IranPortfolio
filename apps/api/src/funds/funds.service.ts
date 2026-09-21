import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractFundReportText, safeUploadFileName } from './extract-report-text';
import { bucketAsset, fundShift, ClassKey } from '../intelligence/engine';

type FundHoldingInput = {
  symbol?: string;
  nameFa?: string;
  assetKind?: string;
  action?: string;
  weightPct?: number;
  amountRial?: number;
  quantity?: number;
};

type FundAnalysis = {
  guessedStrategyFa: string;
  rating: number;
  managerTechnicalScore?: number;
  managerTechnicalReasonFa?: string;
  riskAppetiteScore?: number;
  riskAppetiteReasonFa?: string;
  professionalismScore?: number;
  professionalismReasonFa?: string;
  useInSuggestions: boolean;
  lessons: Array<{ titleFa: string; bodyFa: string }>;
  strengthsFa?: string;
  weaknessesFa?: string;
  allocationSummaryFa?: string;
  holdings?: FundHoldingInput[];
};

const HOLDING_KINDS = new Set(['STOCK', 'BOND', 'GOLD', 'CASH', 'DEPOSIT', 'FUND', 'OTHER']);
const HOLDING_ACTIONS = new Set(['HELD', 'BOUGHT', 'SOLD']);

function normalizeHoldingKind(v: unknown): string {
  const s = String(v ?? 'OTHER').toUpperCase().trim();
  if (HOLDING_KINDS.has(s)) return s;
  if (/اوراق|bond|صکوک|اخزا/i.test(String(v))) return 'BOND';
  if (/طلا|gold|عیار/i.test(String(v))) return 'GOLD';
  if (/نقد|cash|وجه/i.test(String(v))) return 'CASH';
  if (/سپرده|deposit|بانک/i.test(String(v))) return 'DEPOSIT';
  if (/صندوق|fund|etf/i.test(String(v))) return 'FUND';
  if (/سهام|stock|share/i.test(String(v))) return 'STOCK';
  return 'OTHER';
}

function normalizeHoldingAction(v: unknown): string {
  const s = String(v ?? 'HELD').toUpperCase().trim();
  if (HOLDING_ACTIONS.has(s)) return s;
  if (/خرید|buy|bought/i.test(String(v))) return 'BOUGHT';
  if (/فروش|sell|sold/i.test(String(v))) return 'SOLD';
  return 'HELD';
}

function normalizeSymbol(symbol?: string, nameFa?: string): string {
  const raw = (symbol || nameFa || '').trim();
  return raw.replace(/\s+/g, ' ').slice(0, 64) || 'UNKNOWN';
}

function normalizeFundWebsite(raw?: string): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new BadRequestException('آدرس سایت صندوق نامعتبر است');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) {
    throw new BadRequestException('آدرس سایت صندوق نامعتبر است');
  }
  const out = url.toString();
  if (out.length > 500) throw new BadRequestException('آدرس سایت صندوق بیش از حد طولانی است');
  return out;
}

function clampScore(n: unknown): number | null {
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  return Math.min(10, Math.max(1, Math.round(v * 10) / 10));
}

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  listDefinitions(userId: string, includeInactive = false) {
    return this.prisma.fundDefinition.findMany({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { nameFa: 'asc' }],
    });
  }

  createDefinition(
    userId: string,
    data: { nameFa: string; symbolCode?: string; description?: string; websiteUrl?: string },
  ) {
    return this.prisma.fundDefinition.create({
      data: {
        userId,
        nameFa: data.nameFa.trim(),
        symbolCode: data.symbolCode?.trim(),
        description: data.description?.trim(),
        websiteUrl: normalizeFundWebsite(data.websiteUrl),
      },
    });
  }

  async removeDefinition(userId: string, id: string) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    await this.prisma.fundDefinition.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  async updateDefinition(
    userId: string,
    id: string,
    data: { nameFa?: string; symbolCode?: string; description?: string; websiteUrl?: string },
  ) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    return this.prisma.fundDefinition.update({
      where: { id },
      data: {
        ...(data.nameFa !== undefined ? { nameFa: data.nameFa.trim() } : {}),
        ...(data.symbolCode !== undefined ? { symbolCode: data.symbolCode.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
        ...(data.websiteUrl !== undefined ? { websiteUrl: normalizeFundWebsite(data.websiteUrl) } : {}),
      },
    });
  }

  async setDefinitionActive(userId: string, id: string, isActive: boolean) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    return this.prisma.fundDefinition.update({
      where: { id },
      data: { isActive },
    });
  }

  list(userId: string) {
    return this.prisma.fundReport.findMany({
      where: { userId },
      orderBy: [{ reportYear: 'desc' }, { reportMonthNum: 'desc' }, { createdAt: 'desc' }],
      include: {
        lessons: true,
        fundDefinition: true,
        holdings: {
          orderBy: [{ action: 'asc' }, { weightPct: 'desc' }],
          take: 60,
        },
        _count: { select: { holdings: true } },
      },
    });
  }

  async getTimeline(userId: string, fundDefinitionId: string) {
    const def = await this.prisma.fundDefinition.findFirst({
      where: { id: fundDefinitionId, userId },
    });
    if (!def) throw new NotFoundException('صندوق یافت نشد');

    const reports = await this.prisma.fundReport.findMany({
      where: { userId, fundDefinitionId },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
    });
    const insights = await this.prisma.fundTimelineInsight.findMany({
      where: { userId, fundDefinitionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { fund: def, reports, insights };
  }

  async remove(userId: string, id: string) {
    const report = await this.prisma.fundReport.findFirst({ where: { id, userId } });
    if (!report) throw new NotFoundException('گزارش پیدا نشد');

    await this.prisma.$transaction([
      this.prisma.lesson.deleteMany({ where: { fundReportId: id, userId } }),
      this.prisma.fundReport.delete({ where: { id } }),
    ]);

    if (report.filePath) {
      try {
        await fs.unlink(report.filePath);
      } catch {
        /* ignore */
      }
    }

    if (report.fundDefinitionId) {
      await this.analyzeTimeline(userId, report.fundDefinitionId).catch(() => undefined);
    }

    return { ok: true, id };
  }

  async uploadAndAnalyze(
    userId: string,
    file: Express.Multer.File,
    fundDefinitionId: string,
    reportYear: number,
    reportMonthNum: number,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('فایل گزارش ارسال نشده است');
    }
    if (reportMonthNum < 1 || reportMonthNum > 12) {
      throw new BadRequestException('ماه شمسی باید بین ۱ تا ۱۲ باشد');
    }

    const def = await this.prisma.fundDefinition.findFirst({
      where: { id: fundDefinitionId, userId, isActive: true },
    });
    if (!def) throw new NotFoundException('صندوق را از تنظیمات تعریف کنید');

    const reportMonth = `${reportYear}-${String(reportMonthNum).padStart(2, '0')}`;
    const fundName = def.nameFa;

    const { kind, text: extractedText, excel } = await extractFundReportText(file);
    if (kind === 'unknown' && !extractedText) {
      throw new BadRequestException('فرمت فایل پشتیبانی نمی‌شود. PDF یا Excel (xlsx/xls) بفرستید.');
    }

    const sheetsPayload = excel
      ? {
          sheetCount: excel.sheetCount,
          sheetNames: excel.sheetNames,
          sheets: excel.sheets.map((s) => ({
            name: s.name,
            category: s.category,
            priority: s.priority,
            rowCount: s.rowCount,
            sectionTitles: s.sectionTitles,
            headers: s.headers,
            rows: s.rows,
          })),
        }
      : null;

    const dir = path.join(process.cwd(), 'uploads', 'funds');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeUploadFileName(file.originalname));
    await fs.writeFile(filePath, file.buffer);

    const analysis = await this.runFundAnalysis(
      userId,
      fundName,
      reportMonth,
      kind,
      extractedText,
      excel,
    );

    const report = await this.prisma.fundReport.create({
      data: {
        userId,
        fundDefinitionId,
        fundName,
        reportMonth,
        reportYear,
        reportMonthNum,
        filePath,
        extractedText,
        extractedSheetsJson: sheetsPayload ?? undefined,
        guessedStrategyFa: analysis.guessedStrategyFa,
        rating: analysis.rating,
        managerTechnicalScore: analysis.managerTechnicalScore,
        riskAppetiteScore: analysis.riskAppetiteScore,
        professionalismScore: analysis.professionalismScore,
        useInSuggestions: Boolean(analysis.useInSuggestions && (analysis.rating ?? 0) >= 7),
        analysisJson: analysis as object,
      },
    });

    for (const lesson of analysis.lessons ?? []) {
      await this.prisma.lesson.create({
        data: {
          userId,
          fundReportId: report.id,
          titleFa: lesson.titleFa,
          bodyFa: lesson.bodyFa,
          source: 'fund_report',
        },
      });
    }

    await this.persistHoldings(userId, report.id, fundDefinitionId, reportYear, reportMonthNum, analysis.holdings);

    await this.analyzeTimeline(userId, fundDefinitionId).catch(() => undefined);

    return this.prisma.fundReport.findUnique({
      where: { id: report.id },
      include: { lessons: true, fundDefinition: true, holdings: true },
    });
  }

  private async persistHoldings(
    userId: string,
    fundReportId: string,
    fundDefinitionId: string | null | undefined,
    reportYear: number | null | undefined,
    reportMonthNum: number | null | undefined,
    holdings: FundHoldingInput[] | undefined,
  ) {
    const list = Array.isArray(holdings) ? holdings : [];
    const rows = list
      .map((h) => {
        const nameFa = String(h.nameFa ?? h.symbol ?? '').trim();
        const symbol = normalizeSymbol(h.symbol, h.nameFa);
        if (!nameFa && symbol === 'UNKNOWN') return null;
        const weightPct = h.weightPct != null ? Number(h.weightPct) : null;
        const amountRial = h.amountRial != null ? Number(h.amountRial) : null;
        const quantity = h.quantity != null ? Number(h.quantity) : null;
        return {
          fundReportId,
          fundDefinitionId: fundDefinitionId || null,
          userId,
          symbol,
          nameFa: nameFa || symbol,
          assetKind: normalizeHoldingKind(h.assetKind),
          action: normalizeHoldingAction(h.action),
          weightPct: weightPct != null && Number.isFinite(weightPct) ? weightPct : null,
          amountRial: amountRial != null && Number.isFinite(amountRial) ? amountRial : null,
          quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
          reportYear: reportYear ?? null,
          reportMonthNum: reportMonthNum ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .slice(0, 80);

    await this.prisma.fundHolding.deleteMany({ where: { fundReportId } });
    if (!rows.length) return;
    await this.prisma.fundHolding.createMany({ data: rows });
  }

  async listReportHoldings(userId: string, reportId: string) {
    const report = await this.prisma.fundReport.findFirst({ where: { id: reportId, userId } });
    if (!report) throw new NotFoundException('گزارش یافت نشد');
    return this.prisma.fundHolding.findMany({
      where: { fundReportId: reportId, userId },
      orderBy: [{ action: 'asc' }, { weightPct: 'desc' }, { amountRial: 'desc' }],
    });
  }

  async listFundHoldings(userId: string, fundDefinitionId: string, reportId?: string) {
    await this.requireDefinition(userId, fundDefinitionId);
    if (reportId) {
      return this.listReportHoldings(userId, reportId);
    }
    const latest = await this.prisma.fundReport.findFirst({
      where: { userId, fundDefinitionId },
      orderBy: [{ reportYear: 'desc' }, { reportMonthNum: 'desc' }],
    });
    if (!latest) return [];
    return this.listReportHoldings(userId, latest.id);
  }

  /** روند یک نماد در سبد صندوق طی ماه‌ها (وزن موجودی HELD) */
  async symbolTrend(userId: string, fundDefinitionId: string, symbol: string) {
    await this.requireDefinition(userId, fundDefinitionId);
    const key = normalizeSymbol(symbol);
    if (!symbol?.trim() || key === 'UNKNOWN') {
      return { symbol: '', trend: 'unknown' as const, points: [] };
    }
    const rows = await this.prisma.fundHolding.findMany({
      where: {
        userId,
        fundDefinitionId,
        symbol: { equals: key, mode: 'insensitive' },
        action: 'HELD',
      },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
      include: {
        fundReport: { select: { id: true, reportMonth: true, reportYear: true, reportMonthNum: true } },
      },
    });
    const points = rows.map((r) => ({
      reportId: r.fundReportId,
      symbol: r.symbol,
      nameFa: r.nameFa,
      weightPct: r.weightPct,
      amountRial: r.amountRial,
      quantity: r.quantity,
      reportYear: r.reportYear,
      reportMonthNum: r.reportMonthNum,
      reportMonth: r.fundReport.reportMonth,
    }));
    let trend: 'up' | 'down' | 'flat' | 'unknown' = 'unknown';
    const weights = points.map((p) => p.weightPct).filter((w): w is number => w != null && w >= 0);
    if (weights.length >= 2) {
      const first = weights[0];
      const last = weights[weights.length - 1];
      const delta = last - first;
      if (Math.abs(delta) < 0.15) trend = 'flat';
      else trend = delta > 0 ? 'up' : 'down';
    }
    return { symbol: key, trend, points };
  }

  /** تغییر وزن کلاس‌ها بین گزارش‌ها؛ مشاهده است نه پیش‌بینی مدیر */
  async fundBehavior(userId: string, fundDefinitionId: string) {
    await this.requireDefinition(userId, fundDefinitionId);
    const rows = await this.prisma.fundHolding.findMany({
      where: { userId, fundDefinitionId, action: 'HELD' },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
    });
    const groups = new Map<string, { label: string; sums: Partial<Record<ClassKey, number>> }>();
    for (const row of rows) {
      const key = `${row.reportYear ?? 0}-${String(row.reportMonthNum ?? 0).padStart(2, '0')}`;
      const label = row.reportMonthNum ? `${row.reportYear ?? ''} / ${row.reportMonthNum}` : key;
      const group = groups.get(key) ?? { label, sums: {} };
      const asset = kindToClass(row.assetKind);
      if (asset && row.weightPct != null && row.weightPct > 0) {
        group.sums[asset] = (group.sums[asset] ?? 0) + row.weightPct;
      }
      groups.set(key, group);
    }
    const periods = [...groups.values()].map((g) => {
      const total = Object.values(g.sums).reduce((s, n) => s + (n ?? 0), 0) || 1;
      const weights: Partial<Record<ClassKey, number>> = {};
      for (const [k, v] of Object.entries(g.sums)) {
        weights[k as ClassKey] = Math.round((((v ?? 0) / total) * 100) * 10) / 10;
      }
      return { label: g.label, weights };
    });
    const observed = fundShift(periods);
    if (observed.enough) {
      observed.noteFa += ' وزن‌ها فقط بین دارایی‌های طبقه‌بندی‌شدهٔ همان گزارش نرمال شده‌اند.';
    }
    return observed;
  }

  async listTrackedSymbols(userId: string, fundDefinitionId: string) {
    await this.requireDefinition(userId, fundDefinitionId);
    const rows = await this.prisma.fundHolding.findMany({
      where: { userId, fundDefinitionId, action: 'HELD' },
      distinct: ['symbol'],
      select: { symbol: true, nameFa: true },
      orderBy: { symbol: 'asc' },
      take: 200,
    });
    return rows;
  }

  private async requireDefinition(userId: string, fundDefinitionId: string) {
    const def = await this.prisma.fundDefinition.findFirst({
      where: { id: fundDefinitionId, userId },
    });
    if (!def) throw new NotFoundException('صندوق یافت نشد');
    return def;
  }

  async analyzeTimeline(userId: string, fundDefinitionId: string) {
    const reports = await this.prisma.fundReport.findMany({
      where: { userId, fundDefinitionId },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
      include: {
        holdings: {
          select: {
            symbol: true,
            nameFa: true,
            assetKind: true,
            action: true,
            weightPct: true,
            amountRial: true,
          },
          take: 50,
        },
      },
    });
    if (reports.length < 2) {
      return { ok: false, reason: 'حداقل دو گزارش ماهانه لازم است' };
    }

    const prev = reports[reports.length - 2];
    const curr = reports[reports.length - 1];

    type TimelineOut = {
      summaryFa: string;
      strategyChangeFa: string;
      holdingsDiffFa: string;
      llmReasoningFa: string;
    };

    let out: TimelineOut;
    try {
      const system = await this.llm.getSystemPrompt(userId, 'fund_timeline_analysis');
      out = await this.llm.chatJson<TimelineOut>(
        'fund_timeline_analysis',
        system,
        JSON.stringify({
          fundName: curr.fundName,
          from: {
            month: prev.reportMonth,
            strategy: prev.guessedStrategyFa,
            holdings: prev.holdings,
            sheets: this.sheetNamesFromJson(prev.extractedSheetsJson),
            excerpt: (prev.extractedText ?? '').slice(0, 6000),
          },
          to: {
            month: curr.reportMonth,
            strategy: curr.guessedStrategyFa,
            holdings: curr.holdings,
            sheets: this.sheetNamesFromJson(curr.extractedSheetsJson),
            excerpt: (curr.extractedText ?? '').slice(0, 6000),
          },
        }),
        userId,
      );
    } catch (e) {
      out = {
        summaryFa: 'تحلیل مقایسه‌ای بدون LLM',
        strategyChangeFa: `${prev.guessedStrategyFa ?? ''} → ${curr.guessedStrategyFa ?? ''}`,
        holdingsDiffFa: 'مقایسه دستی لازم است',
        llmReasoningFa: (e as Error).message.slice(0, 200),
      };
    }

    const insight = await this.prisma.fundTimelineInsight.create({
      data: {
        userId,
        fundDefinitionId,
        fromReportId: prev.id,
        toReportId: curr.id,
        summaryFa: out.summaryFa,
        strategyChangeFa: out.strategyChangeFa,
        holdingsDiffFa: out.holdingsDiffFa,
        llmReasoningFa: out.llmReasoningFa,
      },
    });

    return { ok: true, insight };
  }

  private sheetNamesFromJson(json: unknown): string[] {
    if (!json || typeof json !== 'object') return [];
    const o = json as { sheetNames?: string[]; sheets?: Array<{ name: string }> };
    if (Array.isArray(o.sheetNames) && o.sheetNames.length) return o.sheetNames;
    if (Array.isArray(o.sheets)) return o.sheets.map((s) => s.name).filter(Boolean);
    return [];
  }

  private async runFundAnalysis(
    userId: string,
    fundName: string,
    reportMonth: string,
    kind: string,
    extractedText: string,
    excel?: import('./extract-report-text').ExcelExtractionResult,
  ): Promise<FundAnalysis> {
    const sheetOverview = excel?.sheets.map((s) => ({
      name: s.name,
      category: s.category,
      rowCount: s.rowCount,
      dataRows: s.rows.length,
      sectionTitles: s.sectionTitles.slice(0, 5),
    }));

    try {
      const system = await this.llm.getSystemPrompt(userId, 'fund_report_analysis');
      const analysis = await this.llm.chatJson<FundAnalysis>(
        'fund_report_analysis',
        system,
        `نام صندوق: ${fundName}
ماه گزارش: ${reportMonth}
نوع فایل: ${kind}
${excel ? `تعداد شیت اکسل: ${excel.sheetCount}\nشیت‌ها: ${excel.sheetNames.join('، ')}` : ''}
${sheetOverview ? `خلاصه شیت‌ها:\n${JSON.stringify(sheetOverview, null, 2)}` : ''}

متن استخراج‌شده (همهٔ شیت‌ها):
${extractedText || 'متن استخراج نشد'}`,
        userId,
      );
      if (!analysis.guessedStrategyFa) throw new Error('فیلد guessedStrategyFa نبود');
      analysis.lessons = Array.isArray(analysis.lessons) ? analysis.lessons : [];
      analysis.holdings = Array.isArray(analysis.holdings) ? analysis.holdings : [];
      analysis.rating = clampScore(analysis.rating) ?? 5;
      analysis.managerTechnicalScore = clampScore(analysis.managerTechnicalScore) ?? undefined;
      analysis.riskAppetiteScore = clampScore(analysis.riskAppetiteScore) ?? undefined;
      analysis.professionalismScore = clampScore(analysis.professionalismScore) ?? undefined;

      const scoreParts: string[] = [];
      if (analysis.managerTechnicalScore != null) {
        scoreParts.push(
          `نمره فنی مدیر: ${analysis.managerTechnicalScore}/10` +
            (analysis.managerTechnicalReasonFa ? ` — ${analysis.managerTechnicalReasonFa}` : ''),
        );
      }
      if (analysis.riskAppetiteScore != null) {
        scoreParts.push(
          `ریسک‌پذیری: ${analysis.riskAppetiteScore}/10` +
            (analysis.riskAppetiteReasonFa ? ` — ${analysis.riskAppetiteReasonFa}` : ''),
        );
      }
      if (analysis.professionalismScore != null) {
        scoreParts.push(
          `حرفه‌ای‌بودن مالی: ${analysis.professionalismScore}/10` +
            (analysis.professionalismReasonFa ? ` — ${analysis.professionalismReasonFa}` : ''),
        );
      }
      if (analysis.allocationSummaryFa) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\nتخصیص: ${analysis.allocationSummaryFa}`;
      }
      if (scoreParts.length) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\n${scoreParts.join('\n')}`;
      }
      return analysis;
    } catch (e) {
      const detail = (e as Error).message?.slice(0, 240) || 'خطای نامشخص';
      return {
        guessedStrategyFa: `تحلیل LLM در دسترس نبود؛ بررسی دستی لازم است. (${detail})`,
        rating: 5,
        useInSuggestions: false,
        lessons: [],
        holdings: [],
        managerTechnicalScore: undefined,
        riskAppetiteScore: undefined,
        professionalismScore: undefined,
      };
    }
  }
}

function kindToClass(kind: string): ClassKey | null {
  if (kind === 'GOLD') return bucketAsset('PHYSICAL_GOLD');
  if (kind === 'CASH') return 'cash';
  if (kind === 'BOND' || kind === 'DEPOSIT' || kind === 'FUND') return 'fixed';
  if (kind === 'STOCK') return 'equity';
  return null;
}
