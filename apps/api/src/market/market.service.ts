import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import {
  foldFa,
  isTehranMarketScoped,
  MARKET_CHAT_REFUSE_FA,
  tokenizeMarketQuestion,
  wantsEqualWeightIndex,
  wantsTotalIndex,
} from './tehran-chat';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.tsetmc.com/',
  Origin: 'https://www.tsetmc.com',
};

const GOLD_SYMBOLS = new Set(['عیار', 'طلا', 'گوهر', 'زر', 'ناب', 'مثقال', 'جواهر']);

/** شاخص کل و هم‌وزن بورس تهران (TSETMC) */
const MARKET_INDICES = [
  {
    key: 'total' as const,
    insCode: '32097828799138957',
    symbol: 'TEDPIX',
    nameFa: 'شاخص کل',
    unit: 'point' as const,
  },
  {
    key: 'equalWeight' as const,
    insCode: '67130298613737946',
    symbol: 'TESWEQ',
    nameFa: 'شاخص هم‌وزن',
    unit: 'point' as const,
  },
];

/** معادل دلاری: شاخص تقسیم بر دلار آزاد به تومان. insCode ساختگی است تا با کد TSETMC قاطی نشود. */
const USD_MARKET_INDICES = [
  {
    key: 'totalUsd' as const,
    baseKey: 'total' as const,
    insCode: 'USD-TEDPIX',
    symbol: 'TEDPIXUSD',
    nameFa: 'شاخص کل دلاری',
    unit: 'usd' as const,
  },
  {
    key: 'equalWeightUsd' as const,
    baseKey: 'equalWeight' as const,
    insCode: 'USD-TESWEQ',
    symbol: 'TESWEQUSD',
    nameFa: 'شاخص هم‌وزن دلاری',
    unit: 'usd' as const,
  },
];

const INDEX_DISPLAY_ORDER = ['total', 'totalUsd', 'equalWeight', 'equalWeightUsd'] as const;

type MarketIndexKey = (typeof MARKET_INDICES)[number]['key'];
type IndexLiveSnap = { lastValue: number; changePct: number | null };

function isEqualWeightIndexName(name: string): boolean {
  return /هم\s*وزن/.test(foldFa(name));
}

function isTotalIndexName(name: string): boolean {
  const n = foldFa(name);
  return /شاخص\s*کل/.test(n) && !/هم\s*وزن/.test(n);
}

/** تاریخ تقویمی تهران (بازار ایران)، نه UTC کانتینر */
function tehranNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }));
}

function todayDateOnly(): Date {
  const d = tehranNow();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function toDEven(d = tehranNow()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function shiftDEven(dEven: string, daysBack: number): string {
  const y = Number(dEven.slice(0, 4));
  const m = Number(dEven.slice(4, 6)) - 1;
  const day = Number(dEven.slice(6, 8));
  const d = new Date(Date.UTC(y, m, day));
  d.setUTCDate(d.getUTCDate() - daysBack);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function dEvenToDate(dEven: string): Date {
  const y = Number(dEven.slice(0, 4));
  const m = Number(dEven.slice(4, 6)) - 1;
  const day = Number(dEven.slice(6, 8));
  return new Date(Date.UTC(y, m, day));
}

function tradeDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** شاخص دلاری = امتیاز شاخص ÷ (دلار آزاد به تومان). usdIrr به ریال است. */
function indexPointsToUsd(points: number, usdIrr: number): number | null {
  const toman = usdIrr / 10;
  if (!(points > 0) || !(toman > 0)) return null;
  return Math.round((points / toman) * 100) / 100;
}

function usdIrrOnOrBefore(
  rates: Array<{ dateKey: string; usdIrr: number }>,
  dateKey: string,
): number | null {
  let found: number | null = null;
  for (const row of rates) {
    if (row.dateKey > dateKey) break;
    found = row.usdIrr;
  }
  return found;
}

/** پنجشنبه و جمعه بورس تهران تعطیل است */
function isTehranWeekend(dEven: string): boolean {
  const dow = dEvenToDate(dEven).getUTCDay();
  return dow === 4 || dow === 5;
}

/** حداکثر چند روز معاملاتی در هر به‌روزرسانی (جلوگیری از پیمایش سال‌ها) */
const MAX_INGEST_TRADING_DAYS = 5;
const MAX_LOOKBACK_CALENDAR_DAYS = 14;

type IngestRow = Record<string, unknown>;

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);
  private ingestInFlight = false;
  private indexSnapshotInFlight: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** هر روز ۲۲:۰۰ به وقت ایران ≈ ۱۸:۳۰ UTC */
  @Cron('0 30 18 * * *')
  async scheduledIngest() {
    this.logger.log('بروزرسانی زمان‌بندی‌شده بازار از TSETMC (۲۲ شب ایران)');
    try {
      await this.ingestCatchUp();
    } catch (e) {
      this.logger.error('کرون اینجست بازار ناموفق', e as Error);
    }
  }

  async listLatest(params: {
    q?: string;
    assetType?: AssetType;
    take?: number;
    page?: number;
  }) {
    const take = Math.min(Math.max(params.take ?? 20, 1), 100);
    const page = Math.max(params.page ?? 1, 1);
    const skip = (page - 1) * take;
    const where = {
      isActive: true,
      assetType: params.assetType ? params.assetType : { not: AssetType.INDEX },
      ...(params.q
        ? {
            OR: [
              { symbol: { contains: params.q } },
              { nameFa: { contains: params.q } },
            ],
          }
        : {}),
    };

    const [total, instruments, lastInstrument, lastBar] = await Promise.all([
      this.prisma.instrument.count({ where }),
      this.prisma.instrument.findMany({
        where,
        skip,
        take,
        orderBy: { symbol: 'asc' },
        include: {
          priceBars: {
            orderBy: { tradeDate: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.instrument.aggregate({
        where: { isActive: true },
        _max: { updatedAt: true },
      }),
      this.prisma.priceBar.aggregate({
        _max: { createdAt: true },
      }),
    ]);

    const items = instruments.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      nameFa: i.nameFa,
      assetType: i.assetType,
      insCode: i.insCode,
      last: i.priceBars[0] ?? null,
    }));

    const stamps = [lastInstrument._max.updatedAt, lastBar._max.createdAt].filter(
      (d): d is Date => d instanceof Date,
    );
    const updatedAt =
      stamps.length > 0
        ? new Date(Math.max(...stamps.map((d) => d.getTime()))).toISOString()
        : null;

    return {
      items,
      total,
      page,
      pageSize: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
      updatedAt,
    };
  }

  async getInstrument(id: string) {
    const i = await this.prisma.instrument.findUnique({
      where: { id },
      include: {
        priceBars: { orderBy: { tradeDate: 'desc' }, take: 1 },
      },
    });
    if (!i) return null;
    return {
      id: i.id,
      symbol: i.symbol,
      nameFa: i.nameFa,
      assetType: i.assetType,
      insCode: i.insCode,
      meta: i.meta,
      last: i.priceBars[0] ?? null,
    };
  }

  async getPriceHistory(id: string, limit = 90) {
    const bars = await this.prisma.priceBar.findMany({
      where: { instrumentId: id },
      orderBy: { tradeDate: 'desc' },
      take: Math.min(Math.max(limit, 1), 2000),
    });
    return bars
      .reverse()
      .map((b) => ({
        tradeDate: b.tradeDate,
        lastPrice: b.lastPrice,
        closePrice: b.closePrice,
        eps: b.eps,
        pe: b.pe,
        volume: b.volume,
      }));
  }

  async askAboutInstrument(userId: string, id: string, question: string) {
    const inst = await this.getInstrument(id);
    if (!inst) throw new NotFoundException('نماد یافت نشد');
    const history = await this.getPriceHistory(id, 60);
    const system = await this.llm.getSystemPrompt(userId, 'market_symbol_qa');
    const answer = await this.llm.chatText(
      'market_symbol_qa',
      system,
      JSON.stringify(
        {
          instrument: {
            symbol: inst.symbol,
            nameFa: inst.nameFa,
            assetType: inst.assetType,
            last: inst.last,
          },
          recentBars: history.slice(-20),
          question,
        },
        null,
        2,
      ),
      userId,
    );
    return { answer };
  }

  async getChat(userId: string) {
    return this.prisma.marketChatMessage.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async hideChat(userId: string) {
    await this.prisma.marketChatMessage.updateMany({
      where: { userId, status: 'active' },
      data: { status: 'hidden' },
    });
    return { ok: true };
  }

  async postChat(userId: string, role: string, message: string) {
    const text = message.trim().slice(0, 800);
    if (text.length < 2) throw new BadRequestException('متن پیام کوتاه است');

    await this.prisma.marketChatMessage.create({
      data: { userId, role: 'user', contentFa: text },
    });

    const mentioned = await this.findMentionedInstruments(userId, role, text);
    const inScope = isTehranMarketScoped(text, mentioned.length);

    let reply = MARKET_CHAT_REFUSE_FA;
    if (inScope) {
      try {
        reply = await this.answerTehranMarketChat(userId, role, text, mentioned);
      } catch (e) {
        reply = `متأسفانه مدل زبانی در دسترس نیست. (${(e as Error).message.slice(0, 120)})`;
      }
    }

    return this.prisma.marketChatMessage.create({
      data: { userId, role: 'assistant', contentFa: reply },
    });
  }

  private async answerTehranMarketChat(
    userId: string,
    role: string,
    question: string,
    mentioned: Array<{ id: string; symbol: string; nameFa: string; assetType: AssetType }>,
  ) {
    const instruments = await this.buildInstrumentChatContext(mentioned);
    const fundHoldings = await this.buildFundHoldingsContext(userId, role, mentioned);
    const indices = await this.readMarketIndices(5);
    const indexDigest = indices.map((i) => ({
      nameFa: i.nameFa,
      symbol: i.symbol,
      lastValue: i.lastValue,
      changePct: i.changePct,
    }));

    const history = await this.prisma.marketChatMessage.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 24,
    });
    const historyText = history
      .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.contentFa}`)
      .join('\n');

    const system = await this.llm.getSystemPrompt(userId, 'market_tehran_chat');
    return this.llm.chatText(
      'market_tehran_chat',
      system,
      `دادهٔ پایگاه سبدیار (تنها منبع مجاز):\n${JSON.stringify(
        {
          question,
          instruments,
          fundHoldings,
          indices: indexDigest,
          noteFa:
            'fundHoldings فقط گزارش‌های صندوق ذخیره‌شده است. اگر خالی است یعنی در دیتابیس خرید/موجودی ثبت نشده.',
        },
        null,
        2,
      )}\n\nگفتگو:\n${historyText}`,
      userId,
    );
  }

  private async findMentionedInstruments(userId: string, role: string, question: string) {
    const tokens = tokenizeMarketQuestion(question);
    const or: Prisma.InstrumentWhereInput[] = tokens.flatMap((t) => {
      const clauses: Prisma.InstrumentWhereInput[] = [{ symbol: t }];
      if (t.length >= 3) clauses.push({ nameFa: { contains: t } });
      return clauses;
    });

    if (wantsTotalIndex(question)) or.push({ symbol: 'TEDPIX', assetType: AssetType.INDEX });
    if (wantsEqualWeightIndex(question)) or.push({ symbol: 'TESWEQ', assetType: AssetType.INDEX });

    const rows = or.length
      ? await this.prisma.instrument.findMany({
          where: {
            isActive: true,
            assetType: { in: [AssetType.STOCK, AssetType.INDEX, AssetType.FUND, AssetType.GOLD_ETF] },
            OR: or,
          },
          take: 24,
          select: { id: true, symbol: true, nameFa: true, assetType: true },
        })
      : [];

    const foldedQ = foldFa(question);
    const tokenSet = new Set(tokens);
    const needTotal = wantsTotalIndex(question);
    const needEqual = wantsEqualWeightIndex(question);
    const scored = rows
      .map((r) => {
        const sym = foldFa(r.symbol);
        const name = foldFa(r.nameFa);
        let score = 0;
        if (tokenSet.has(sym) || (sym.length >= 3 && foldedQ.includes(sym))) score += 8;
        if (tokens.some((t) => t.length >= 3 && name.includes(t))) score += 3;
        if (needTotal && (r.symbol === 'TEDPIX' || name.includes('شاخص کل'))) score += 10;
        if (needEqual && (r.symbol === 'TESWEQ' || /هم[\s‌-]*وزن/.test(name))) score += 10;
        if (r.assetType === AssetType.STOCK) score += 1;
        return { ...r, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const out: Array<{ id: string; symbol: string; nameFa: string; assetType: AssetType }> = [];
    for (const r of scored) {
      if (seen.has(r.id) || seen.has(foldFa(r.symbol))) continue;
      seen.add(r.id);
      seen.add(foldFa(r.symbol));
      out.push({ id: r.id, symbol: r.symbol, nameFa: r.nameFa, assetType: r.assetType });
      if (out.length >= 6) break;
    }

    if (tokens.length && out.length < 6) {
      const isAdmin = role === UserRole.ADMIN || role === 'ADMIN';
      const holdings = await this.prisma.fundHolding.findMany({
        where: {
          assetKind: 'STOCK',
          ...(isAdmin ? {} : { userId }),
          OR: tokens.flatMap((t) => {
            const clauses: Prisma.FundHoldingWhereInput[] = [{ symbol: t }];
            if (t.length >= 3) clauses.push({ nameFa: { contains: t } });
            return clauses;
          }),
        },
        take: 20,
        select: { symbol: true, nameFa: true },
      });
      for (const h of holdings) {
        const folded = foldFa(h.symbol);
        if (seen.has(folded)) continue;
        const inst = await this.prisma.instrument.findFirst({
          where: {
            isActive: true,
            OR: [{ symbol: h.symbol }, { symbol: folded }],
          },
          select: { id: true, symbol: true, nameFa: true, assetType: true },
        });
        const row = inst ?? {
          id: '',
          symbol: h.symbol,
          nameFa: h.nameFa,
          assetType: AssetType.STOCK,
        };
        seen.add(folded);
        if (row.id) seen.add(row.id);
        out.push(row);
        if (out.length >= 6) break;
      }
    }

    return out;
  }

  private async buildInstrumentChatContext(
    mentioned: Array<{ id: string; symbol: string; nameFa: string; assetType: AssetType }>,
  ) {
    const out = [];
    for (const inst of mentioned) {
      const bars = inst.id
        ? await this.prisma.priceBar.findMany({
            where: { instrumentId: inst.id },
            orderBy: { tradeDate: 'desc' },
            take: 16,
          })
        : [];
      const last = bars[0] ?? null;
      out.push({
        symbol: inst.symbol,
        nameFa: inst.nameFa,
        assetType: inst.assetType,
        last: last
          ? {
              tradeDate: last.tradeDate,
              lastPrice: last.lastPrice,
              closePrice: last.closePrice,
              eps: last.eps,
              pe: last.pe,
              volume: last.volume,
            }
          : null,
        recentBars: [...bars]
          .reverse()
          .map((b) => ({
            tradeDate: b.tradeDate,
            lastPrice: b.lastPrice,
            closePrice: b.closePrice,
            eps: b.eps,
            pe: b.pe,
            volume: b.volume,
          })),
      });
    }
    return out;
  }

  private async buildFundHoldingsContext(
    userId: string,
    role: string,
    mentioned: Array<{ symbol: string; nameFa: string }>,
  ) {
    if (!mentioned.length) return [];
    const isAdmin = role === UserRole.ADMIN || role === 'ADMIN';
    const or: Prisma.FundHoldingWhereInput[] = mentioned.flatMap((i) => {
      const symbol = foldFa(i.symbol);
      const clauses: Prisma.FundHoldingWhereInput[] = [{ symbol: i.symbol }];
      if (symbol !== i.symbol) clauses.push({ symbol });
      if (symbol.length >= 2) {
        clauses.push({ nameFa: { contains: i.symbol } });
        clauses.push({ symbol: { contains: i.symbol } });
      }
      return clauses;
    });

    const rows = await this.prisma.fundHolding.findMany({
      where: {
        assetKind: 'STOCK',
        action: { in: ['HELD', 'BOUGHT'] },
        ...(isAdmin ? {} : { userId }),
        OR: or,
      },
      include: {
        fundDefinition: { select: { nameFa: true, symbolCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    const actionFa: Record<string, string> = {
      HELD: 'موجودی گزارش',
      BOUGHT: 'خرید طی ماه',
      SOLD: 'فروش طی ماه',
    };

    const seen = new Set<string>();
    const out: Array<{
      fundNameFa: string;
      fundSymbol: string | null;
      symbol: string;
      nameFa: string;
      action: string;
      actionFa: string;
      weightPct: number | null;
      quantity: number | null;
      amountRial: number | null;
      reportYear: number | null;
      reportMonth: number | null;
    }> = [];

    for (const h of rows) {
      const key = `${h.fundDefinitionId ?? h.fundReportId}:${h.symbol}:${h.action}:${h.reportYear ?? ''}:${h.reportMonthNum ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        fundNameFa: h.fundDefinition?.nameFa ?? 'صندوق بدون نام',
        fundSymbol: h.fundDefinition?.symbolCode ?? null,
        symbol: h.symbol,
        nameFa: h.nameFa,
        action: h.action,
        actionFa: actionFa[h.action] ?? h.action,
        weightPct: h.weightPct,
        quantity: h.quantity,
        amountRial: h.amountRial,
        reportYear: h.reportYear,
        reportMonth: h.reportMonthNum,
      });
      if (out.length >= 40) break;
    }
    return out;
  }

  async ingestToday() {
    return this.ingestCatchUp();
  }

  async ingestCatchUp() {
    if (this.ingestInFlight) {
      throw new ServiceUnavailableException('به‌روزرسانی بازار از قبل در حال انجام است. لطفاً صبر کنید.');
    }
    this.ingestInFlight = true;
    try {
      return await this.runIngestCatchUp();
    } finally {
      this.ingestInFlight = false;
    }
  }

  private async runIngestCatchUp() {
    const todayDEven = toDEven();
    const datesToIngest: string[] = [];
    for (let back = 0; back <= MAX_LOOKBACK_CALENDAR_DAYS && datesToIngest.length < MAX_INGEST_TRADING_DAYS; back++) {
      const day = shiftDEven(todayDEven, back);
      if (isTehranWeekend(day)) continue;
      datesToIngest.push(day);
    }
    datesToIngest.reverse();

    this.logger.log(`اینجست بازار برای ${datesToIngest.length} روز معاملاتی: ${datesToIngest.join(', ')}`);

    const days: Array<{ tradeDate: string; upserted: number; source: string }> = [];
    let totalUpserted = 0;

    for (let i = 0; i < datesToIngest.length; i++) {
      const dEven = datesToIngest[i];
      const isLatest = i === datesToIngest.length - 1;
      const result = await this.ingestForDate(dEven, isLatest);
      days.push(result);
      totalUpserted += result.upserted;
    }

    if (!totalUpserted && days.every((d) => d.upserted === 0)) {
      // حتی اگر سهام نیامد، شاخص‌ها را جدا امتحان کن
      try {
        await this.ingestIndices();
      } catch {
        /* ignore */
      }
      throw new ServiceUnavailableException(
        'هیچ داده‌ای از بازار دریافت نشد. سرور شما IP خارج ایران دارد؛ در .env مقدار BRS_API_KEY را از https://brsapi.ir تنظیم کنید و کانتینر api را دوباره بالا بیاورید.',
      );
    }

    try {
      await this.ingestIndices();
    } catch (e) {
      this.logger.warn(`اینجست شاخص‌ها: ${(e as Error).message}`);
    }

    const last = days[days.length - 1];
    return {
      tradeDate: last?.tradeDate ?? todayDEven,
      upserted: totalUpserted,
      source: last?.source ?? 'multi-day',
      days,
      dayCount: days.length,
    };
  }

  private async ingestForDate(dEven: string, runExtras: boolean) {
    const tradeDate = dEvenToDate(dEven);
    const isToday = dEven === toDEven();
    this.logger.log(`اینجست روز ${dEven} (تهران)`);

    const { rows, source } = await this.fetchRowsForDate(dEven, isToday);
    this.logger.log(`منبع ${dEven}: ${source} — ${rows.length} ردیف خام`);

    if (!rows.length) {
      return { tradeDate: dEven, upserted: 0, source };
    }

    let upserted = 0;
    for (const row of rows) {
      const symbol = String(row.lVal18AFC ?? row.symbol ?? '').trim();
      const nameFa = String(row.lVal30 ?? row.name ?? symbol).trim();
      const insCodeRaw = row.insCode != null ? String(row.insCode).trim() : '';
      const insCode = /^\d+$/.test(insCodeRaw) ? insCodeRaw : undefined;
      if (!symbol) continue;

      const assetType = this.detectAssetType(symbol, row);
      const lastPrice = this.num(row.pDrCotVal ?? row.pl ?? row.lastPrice);
      const closePrice = this.num(row.pClosing ?? row.pc ?? row.closePrice ?? row.closingPrice);
      const eps = this.num(row.eps ?? row.estimatedEPS);
      const pe = this.num(row.pe ?? row.sectorPE ?? row.pE);
      const volume = this.num(row.qTotTran5J ?? row.volume ?? row.tradeVolume);

      const instrument = insCode
        ? await this.prisma.instrument.upsert({
            where: { insCode },
            create: { insCode, symbol, nameFa, assetType },
            update: { symbol, nameFa, assetType, isActive: true },
          })
        : await this.prisma.instrument.upsert({
            where: { symbol_assetType: { symbol, assetType } },
            create: { symbol, nameFa, assetType },
            update: { nameFa, isActive: true },
          });

      await this.prisma.priceBar.upsert({
        where: {
          instrumentId_tradeDate: { instrumentId: instrument.id, tradeDate },
        },
        create: {
          instrumentId: instrument.id,
          tradeDate,
          lastPrice,
          closePrice,
          eps,
          pe,
          volume,
          raw: row as Prisma.InputJsonValue,
        },
        update: {
          lastPrice,
          closePrice,
          eps,
          pe,
          volume,
          raw: row as Prisma.InputJsonValue,
        },
      });
      upserted += 1;
    }

    if (runExtras) {
      await this.ensureDepositInstrument(tradeDate);
      await this.ingestOptions(tradeDate);
      if (source.startsWith('cdn.') || source.startsWith('webgw.') || source.startsWith('brsapi.')) {
        await this.enrichEpsPe(80);
      }
    }

    return { tradeDate: dEven, upserted, source };
  }

  async getMarketIndices(historyDays = 60) {
    const take = Math.min(Math.max(historyDays, 5), 365);
    let out = await this.readMarketIndices(take);
    const pointMissing = out.some((i) => i.unit === 'point' && i.lastValue == null);
    if (pointMissing) {
      try {
        await this.ensureLatestIndexValues();
        out = await this.readMarketIndices(take);
      } catch (e) {
        this.logger.warn(`تکمیل شاخص برای نمایش: ${(e as Error).message}`);
      }
    }
    const usdMissingHistory = out.some((i) => i.unit === 'usd' && i.history.length === 0);
    try {
      await this.syncUsdIndexBars(usdMissingHistory ? 'all' : 'latest');
      out = await this.readMarketIndices(take);
    } catch (e) {
      this.logger.warn(`شاخص دلاری: ${(e as Error).message}`);
    }
    return out;
  }

  private async readMarketIndices(take: number) {
    const catalog = [
      ...MARKET_INDICES.map((d) => ({ ...d })),
      ...USD_MARKET_INDICES.map((d) => ({
        key: d.key,
        insCode: d.insCode,
        symbol: d.symbol,
        nameFa: d.nameFa,
        unit: d.unit,
      })),
    ].sort(
      (a, b) =>
        INDEX_DISPLAY_ORDER.indexOf(a.key as (typeof INDEX_DISPLAY_ORDER)[number]) -
        INDEX_DISPLAY_ORDER.indexOf(b.key as (typeof INDEX_DISPLAY_ORDER)[number]),
    );
    const out = [];
    for (const def of catalog) {
      const instrument = await this.prisma.instrument.findFirst({
        where: {
          OR: [{ insCode: def.insCode }, { symbol: def.symbol, assetType: AssetType.INDEX }],
        },
      });
      if (!instrument) {
        out.push({
          id: null as string | null,
          key: def.key,
          symbol: def.symbol,
          nameFa: def.nameFa,
          unit: def.unit,
          lastValue: null as number | null,
          changePct: null as number | null,
          history: [] as Array<{ tradeDate: string; value: number }>,
        });
        continue;
      }
      const bars = await this.prisma.priceBar.findMany({
        where: { instrumentId: instrument.id },
        orderBy: { tradeDate: 'desc' },
        take,
      });
      const chronological = [...bars].reverse();
      const history = chronological
        .map((b) => {
          const value = b.closePrice ?? b.lastPrice;
          if (value == null || !(value > 0)) return null;
          return { tradeDate: b.tradeDate.toISOString(), value };
        })
        .filter((x): x is { tradeDate: string; value: number } => Boolean(x));
      const last = history[history.length - 1]?.value ?? null;
      const prev = history.length >= 2 ? history[history.length - 2]?.value : null;
      const changePct =
        last != null && prev != null && prev > 0 ? ((last - prev) / prev) * 100 : null;
      out.push({
        id: instrument.id,
        key: def.key,
        symbol: def.symbol,
        nameFa: def.nameFa,
        unit: def.unit,
        lastValue: last,
        changePct,
        history,
      });
    }
    return out;
  }

  /** دریافت و ذخیره شاخص کل و هم‌وزن */
  async ingestIndices() {
    let upserted = 0;
    for (const def of MARKET_INDICES) {
      const instrument = await this.prisma.instrument.upsert({
        where: { insCode: def.insCode },
        create: {
          insCode: def.insCode,
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
        },
        update: {
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          isActive: true,
        },
      });

      const points = await this.fetchIndexHistory(def.insCode);
      for (const p of points) {
        await this.prisma.priceBar.upsert({
          where: {
            instrumentId_tradeDate: {
              instrumentId: instrument.id,
              tradeDate: p.tradeDate,
            },
          },
          create: {
            instrumentId: instrument.id,
            tradeDate: p.tradeDate,
            lastPrice: p.value,
            closePrice: p.value,
          },
          update: {
            lastPrice: p.value,
            closePrice: p.value,
          },
        });
        upserted += 1;
      }
    }

    // مقدار روز جاری: اول BrsApi (سرور خارج ایران)، بعد TSETMC
    try {
      upserted += await this.persistLiveIndexSnapshot();
    } catch (e) {
      this.logger.warn(`شاخص لحظه‌ای: ${(e as Error).message}`);
    }
    try {
      upserted += await this.syncUsdIndexBars('all');
    } catch (e) {
      this.logger.warn(`شاخص دلاری: ${(e as Error).message}`);
    }

    this.logger.log(`شاخص‌ها: ${upserted} ردیف ذخیره شد`);
    return { upserted };
  }

  private async ensureLatestIndexValues() {
    if (this.indexSnapshotInFlight) return this.indexSnapshotInFlight;
    this.indexSnapshotInFlight = this.persistLiveIndexSnapshot().finally(() => {
      this.indexSnapshotInFlight = null;
    });
    return this.indexSnapshotInFlight;
  }

  private async persistLiveIndexSnapshot(): Promise<number> {
    const snaps: Partial<Record<MarketIndexKey, IndexLiveSnap>> = {
      ...(await this.fetchBrsApiIndexSnapshot()),
    };
    if (!snaps.total || !snaps.equalWeight) {
      const tse = await this.fetchTsetmcLiveIndexSnapshot();
      if (!snaps.total && tse.total) snaps.total = tse.total;
      if (!snaps.equalWeight && tse.equalWeight) snaps.equalWeight = tse.equalWeight;
    }
    const tradeDate = todayDateOnly();
    let upserted = 0;
    for (const def of MARKET_INDICES) {
      const snap = snaps[def.key];
      if (!snap?.lastValue) continue;
      const instrument = await this.prisma.instrument.upsert({
        where: { insCode: def.insCode },
        create: {
          insCode: def.insCode,
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
        },
        update: {
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          isActive: true,
        },
      });
      await this.prisma.priceBar.upsert({
        where: {
          instrumentId_tradeDate: { instrumentId: instrument.id, tradeDate },
        },
        create: {
          instrumentId: instrument.id,
          tradeDate,
          lastPrice: snap.lastValue,
          closePrice: snap.lastValue,
        },
        update: {
          lastPrice: snap.lastValue,
          closePrice: snap.lastValue,
        },
      });
      upserted += 1;
    }
    try {
      upserted += await this.syncUsdIndexBars('latest');
    } catch (e) {
      this.logger.warn(`شاخص دلاری لحظه‌ای: ${(e as Error).message}`);
    }
    return upserted;
  }

  /** شاخص کل و هم‌وزن را بر دلار آزاد همان روز تقسیم و مثل خود شاخص ذخیره می‌کند. */
  private async syncUsdIndexBars(mode: 'all' | 'latest'): Promise<number> {
    const spots = await this.prisma.spotPriceDaily.findMany({
      where: { usdIrr: { gt: 0 } },
      orderBy: { dateKey: 'asc' },
      select: { dateKey: true, usdIrr: true },
    });
    const rates = spots.filter((s): s is { dateKey: string; usdIrr: number } => s.usdIrr != null && s.usdIrr > 0);
    if (!rates.length) return 0;

    let upserted = 0;
    for (const def of USD_MARKET_INDICES) {
      const base = MARKET_INDICES.find((d) => d.key === def.baseKey);
      if (!base) continue;
      const baseInst = await this.prisma.instrument.findFirst({
        where: {
          OR: [{ insCode: base.insCode }, { symbol: base.symbol, assetType: AssetType.INDEX }],
        },
      });
      if (!baseInst) continue;
      const bars = await this.prisma.priceBar.findMany({
        where: { instrumentId: baseInst.id },
        orderBy: { tradeDate: mode === 'latest' ? 'desc' : 'asc' },
        take: mode === 'latest' ? 1 : undefined,
      });
      if (!bars.length) continue;

      const usdInst = await this.prisma.instrument.upsert({
        where: { insCode: def.insCode },
        create: {
          insCode: def.insCode,
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          meta: { unit: 'usd', baseSymbol: base.symbol },
        },
        update: {
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          isActive: true,
          meta: { unit: 'usd', baseSymbol: base.symbol },
        },
      });

      for (const bar of bars) {
        const points = bar.closePrice ?? bar.lastPrice;
        if (points == null || !(points > 0)) continue;
        const usdIrr = usdIrrOnOrBefore(rates, tradeDateKey(bar.tradeDate));
        const usdValue = usdIrr == null ? null : indexPointsToUsd(points, usdIrr);
        if (usdValue == null) continue;
        await this.prisma.priceBar.upsert({
          where: {
            instrumentId_tradeDate: { instrumentId: usdInst.id, tradeDate: bar.tradeDate },
          },
          create: {
            instrumentId: usdInst.id,
            tradeDate: bar.tradeDate,
            lastPrice: usdValue,
            closePrice: usdValue,
          },
          update: {
            lastPrice: usdValue,
            closePrice: usdValue,
          },
        });
        upserted += 1;
      }
    }
    return upserted;
  }

  private async fetchBrsApiIndexSnapshot(): Promise<Partial<Record<MarketIndexKey, IndexLiveSnap>>> {
    const key = process.env.BRS_API_KEY?.trim();
    if (!key) return {};
    const out: Partial<Record<MarketIndexKey, IndexLiveSnap>> = {};
    try {
      const data = await this.fetchJson(
        `https://Api.BrsApi.ir/Tsetmc/Index.php?key=${encodeURIComponent(key)}&type=1`,
      );
      const row: IngestRow = Array.isArray(data) ? (data[0] as IngestRow) : (data as IngestRow);
      const total = this.num(row?.index ?? row?.Index);
      const equal = this.num(row?.index_equalWeight ?? row?.indexEqualWeight);
      if (total != null && total > 0) {
        out.total = {
          lastValue: total,
          changePct: this.indexChangePct(total, row?.index_change_percent ?? row?.index_change),
        };
      }
      if (equal != null && equal > 0) {
        out.equalWeight = {
          lastValue: equal,
          changePct: this.indexChangePct(
            equal,
            row?.index_equalWeight_change_percent ?? row?.index_equalWeight_change,
          ),
        };
      }
    } catch (e) {
      this.logger.warn(`شاخص BrsApi type=1: ${(e as Error).message}`);
    }
    if (out.total && out.equalWeight) return out;

    try {
      const data = await this.fetchJson(
        `https://Api.BrsApi.ir/Tsetmc/Index.php?key=${encodeURIComponent(key)}&type=3`,
      );
      const list: IngestRow[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];
      for (const row of list) {
        const name = String(row.name ?? row.lVal30 ?? row.title ?? '');
        const value = this.num(row.index ?? row.last ?? row.xDrNivJIdx004);
        if (value == null || !(value > 0)) continue;
        const snap: IndexLiveSnap = {
          lastValue: value,
          changePct: this.indexChangePct(value, row.index_change_percent ?? row.index_change),
        };
        if (!out.equalWeight && isEqualWeightIndexName(name)) out.equalWeight = snap;
        else if (!out.total && isTotalIndexName(name)) out.total = snap;
      }
    } catch (e) {
      this.logger.warn(`شاخص BrsApi type=3: ${(e as Error).message}`);
    }
    return out;
  }

  private async fetchTsetmcLiveIndexSnapshot(): Promise<Partial<Record<MarketIndexKey, IndexLiveSnap>>> {
    const out: Partial<Record<MarketIndexKey, IndexLiveSnap>> = {};
    try {
      const data = await this.fetchJson('https://cdn.tsetmc.com/api/MarketData/GetMarketOverview/1');
      const ov = (data?.marketOverview ?? data) as IngestRow;
      const total = this.num(ov?.indexLastValue ?? ov?.indexValue);
      const equal = this.num(ov?.indexEqualWeightedLastValue ?? ov?.indexEqualWeightedValue);
      if (total != null && total > 0) {
        out.total = {
          lastValue: total,
          changePct: this.indexChangePct(total, ov?.indexChangePercent ?? ov?.indexChange),
        };
      }
      if (equal != null && equal > 0) {
        out.equalWeight = {
          lastValue: equal,
          changePct: this.indexChangePct(
            equal,
            ov?.indexEqualWeightedChangePercent ?? ov?.indexEqualWeightedChange,
          ),
        };
      }
    } catch (e) {
      this.logger.warn(`نمای کلی شاخص TSETMC: ${(e as Error).message}`);
    }
    if (out.total && out.equalWeight) return out;

    try {
      const live = await this.fetchJson(
        'https://cdn.tsetmc.com/api/Index/GetIndexB1LastAll/SelectedIndexes/1',
      );
      const list: IngestRow[] = Array.isArray(live?.indexB1)
        ? live.indexB1
        : Array.isArray(live)
          ? live
          : [];
      for (const def of MARKET_INDICES) {
        if (out[def.key]) continue;
        const row = list.find((x) => {
          const name = String(x.lVal30 ?? x.name ?? '');
          if (def.key === 'equalWeight') return isEqualWeightIndexName(name);
          return isTotalIndexName(name);
        });
        const value = this.indexLevelFromRow(row);
        if (value == null) continue;
        out[def.key] = {
          lastValue: value,
          changePct: this.indexChangePct(value, row?.xVarIdxJRfV ?? row?.indexChange),
        };
      }
    } catch (e) {
      this.logger.warn(`لیست شاخص TSETMC: ${(e as Error).message}`);
    }
    return out;
  }

  private indexLevelFromRow(row?: IngestRow): number | null {
    if (!row) return null;
    return this.num(
      row.xDrNivJIdx004 ??
        row.xNivInesJIdx004 ??
        row.xNivJIdx004 ??
        row.lastValue ??
        row.index ??
        row.pClosing,
    );
  }

  private indexChangePct(last: number, raw: unknown): number | null {
    const n = this.num(raw);
    if (n == null) return null;
    if (Math.abs(n) <= 40) return n;
    if (last - n === 0) return null;
    return (n / (last - n)) * 100;
  }

  private async fetchIndexHistory(
    insCode: string,
  ): Promise<Array<{ tradeDate: Date; value: number }>> {
    try {
      const data = await this.fetchJson(`https://cdn.tsetmc.com/api/Index/GetIndexB2History/${insCode}`);
      const list: IngestRow[] = Array.isArray(data?.indexB2)
        ? data.indexB2
        : Array.isArray(data?.indexB1)
          ? data.indexB1
          : Array.isArray(data)
            ? data
            : [];
      const points = list
        .map((row) => {
          const dEven = String(row.dEven ?? row.date ?? '').replace(/\D/g, '');
          const value = this.indexLevelFromRow(row);
          if (dEven.length !== 8 || value == null || !(value > 0)) return null;
          return { tradeDate: dEvenToDate(dEven), value };
        })
        .filter((x): x is { tradeDate: Date; value: number } => Boolean(x));
      if (points.length) return points;
    } catch (e) {
      this.logger.warn(`تاریخچه شاخص B2 (${insCode}): ${(e as Error).message}`);
    }

    // اولویت بعدی: تاریخچه قیمت پایانی CDN (گاهی برای خود شاخص هم داده می‌دهد)
    try {
      const data = await this.fetchJson(
        `https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceDailyList/${insCode}/90`,
      );
      const list: IngestRow[] = Array.isArray(data?.closingPriceDaily)
        ? data.closingPriceDaily
        : Array.isArray(data)
          ? data
          : [];
      const points = list
        .map((row) => {
          const dEven = String(row.dEven ?? row.date ?? '').replace(/\D/g, '');
          const value = this.num(row.pClosing ?? row.closePrice ?? row.price ?? row.last ?? row.xDrNivJIdx004);
          if (dEven.length !== 8 || value == null || !(value > 0)) return null;
          return { tradeDate: dEvenToDate(dEven), value };
        })
        .filter((x): x is { tradeDate: Date; value: number } => Boolean(x));
      if (points.length) return points;
    } catch (e) {
      this.logger.warn(`تاریخچه شاخص CDN (${insCode}): ${(e as Error).message}`);
    }

    // جایگزین: نمودار قدیمی TSETMC
    try {
      const res = await fetch(
        `https://old.tsetmc.com/tsev2/chart/data/Index.aspx?i=${insCode}&t=value`,
        { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}`);
      const points: Array<{ tradeDate: Date; value: number }> = [];
      for (const line of text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
        const [dPart, vPart] = line.split(',');
        const dEven = String(dPart ?? '').replace(/\D/g, '');
        const value = this.num(vPart);
        if (dEven.length !== 8 || value == null || !(value > 0)) continue;
        points.push({ tradeDate: dEvenToDate(dEven), value });
      }
      if (points.length) {
        // فقط ۹۰ روز اخیر
        return points.slice(-90);
      }
    } catch (e) {
      this.logger.warn(`تاریخچه شاخص legacy (${insCode}): ${(e as Error).message}`);
    }

    return [];
  }

  private async fetchRowsForDate(
    dEven: string,
    isToday: boolean,
  ): Promise<{ rows: IngestRow[]; source: string }> {
    if (!isToday) {
      const hist = await this.fetchHistoryInDay(dEven);
      if (hist.length) return { rows: hist, source: `cdn.HistoryInDay:${dEven}` };
      return { rows: [], source: 'none' };
    }
    return this.fetchMarketRows(dEven);
  }

  private async fetchMarketRows(
    dEven: string,
  ): Promise<{ rows: IngestRow[]; source: string }> {
    // اولویت ۱: BrsApi — از IP خارج ایران کار می‌کند (سرور فعلی Contabo/اروپا)
    const brs = await this.fetchBrsApiAllSymbols();
    if (brs.length) return { rows: brs, source: 'brsapi.AllSymbols' };

    const webgw = await this.fetchWebgwMarketWatch();
    if (webgw.length) return { rows: webgw, source: 'webgw.MarketWatch' };

    for (let back = 0; back <= 6; back++) {
      const day = back === 0 ? dEven : shiftDEven(dEven, back);
      const hist = await this.fetchHistoryInDay(day);
      if (hist.length) {
        return {
          rows: hist,
          source: back === 0 ? `cdn.HistoryInDay:${day}` : `cdn.HistoryInDay:${day}(fallback)`,
        };
      }
    }

    const legacy = await this.fetchMarketWatchLegacy();
    if (legacy.length) return { rows: legacy, source: 'old.MarketWatchInit' };

    return { rows: [], source: 'none' };
  }

  /**
   * پروکسی عمومی TSETMC — مناسب سرور خارج ایران.
   * کلید رایگان: https://brsapi.ir  → متغیر محیطی BRS_API_KEY
   */
  private async fetchBrsApiAllSymbols(): Promise<IngestRow[]> {
    const key = process.env.BRS_API_KEY?.trim();
    if (!key) {
      this.logger.warn(
        'BRS_API_KEY تنظیم نشده؛ برای سرور خارج ایران این کلید لازم است (brsapi.ir).',
      );
      return [];
    }

    const types = (process.env.BRS_API_TYPES ?? '1').split(',').map((t) => t.trim()).filter(Boolean);
    const rows: IngestRow[] = [];
    const seen = new Set<string>();

    for (const type of types) {
      const url = `https://Api.BrsApi.ir/Tsetmc/AllSymbols.php?key=${encodeURIComponent(key)}&type=${encodeURIComponent(type)}`;
      try {
        const data = await this.fetchJson(url);
        const list: unknown[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.AllSymbols)
              ? data.AllSymbols
              : [];
        if (!list.length) {
          this.logger.warn(`BrsApi type=${type}: پاسخ خالی یا غیرمجاز`);
          continue;
        }
        for (const item of list as IngestRow[]) {
          const symbol = String(item.l18 ?? item.lVal18AFC ?? item.symbol ?? '').trim();
          if (!symbol || seen.has(symbol)) continue;
          seen.add(symbol);
          const nameFa = String(item.l30 ?? item.lVal30 ?? item.name ?? symbol).trim();
          const insCode = item.id != null ? String(item.id) : undefined;
          rows.push({
            ...item,
            symbol,
            lVal18AFC: symbol,
            lVal30: nameFa,
            insCode,
            pl: item.pl,
            pc: item.pc,
            eps: item.eps,
            pe: item.pe,
            qTotTran5J: item.tvol,
            assetHint: type === '1' ? undefined : `brs-${type}`,
          });
        }
        this.logger.log(`BrsApi type=${type}: ${list.length} آیتم`);
      } catch (e) {
        this.logger.warn(`BrsApi type=${type} ناموفق: ${(e as Error).message}`);
      }
    }
    return rows;
  }
  private async fetchWebgwMarketWatch(): Promise<IngestRow[]> {
    const paths = [
      { url: 'https://webgw.tse.ir/InstrumentProvider/api/v1/MarketWatch/MarketWatchCash/fa', kind: 'cash' },
      { url: 'https://webgw.tse.ir/InstrumentProvider/api/v1/MarketWatch/MarketWatchEtf/fa', kind: 'etf' },
    ];
    const rows: IngestRow[] = [];
    for (const p of paths) {
      try {
        const data = await this.fetchJson(p.url);
        const items: unknown[] = data?.Items ?? data?.items ?? [];
        if (!Array.isArray(items) || !items.length) {
          this.logger.warn(`webgw ${p.kind}: پاسخ خالی`);
          continue;
        }
        for (const item of items as IngestRow[]) {
          const symbol = String(
            item.instrumentName ?? item.instrument_Name ?? item.namad ?? item.lVal18AFC ?? '',
          ).trim();
          if (!symbol) continue;
          const nameFa = String(
            item.companyNamePersian ?? item.companyName ?? item.lVal30 ?? symbol,
          ).trim();
          const isin = item.instrumentId != null ? String(item.instrumentId) : undefined;
          rows.push({
            ...item,
            symbol,
            lVal18AFC: symbol,
            lVal30: nameFa,
            lastPrice: item.lastPrice ?? item.lastprice,
            closingPrice: item.closingPrice ?? item.closingprice,
            tradeVolume: item.tradeVolume ?? item.tradevolume,
            pe: item.pe,
            eps: item.eps,
            assetHint: p.kind,
            isin,
          });
        }
        this.logger.log(`webgw ${p.kind}: ${items.length} آیتم`);
      } catch (e) {
        this.logger.warn(`webgw ${p.kind} ناموفق: ${(e as Error).message}`);
      }
    }
    return rows;
  }

  private async enrichEpsPe(limit: number) {
    const stocks = await this.prisma.instrument.findMany({
      where: { assetType: AssetType.STOCK, insCode: { not: null } },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
    const tradeDate = todayDateOnly();
    for (const s of stocks) {
      if (!s.insCode) continue;
      try {
        const info = await this.fetchJson(
          `https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/${s.insCode}`,
        );
        const cpi = info?.closingPriceInfo ?? info;
        if (!cpi) continue;
        const eps = this.num(cpi.eps ?? cpi.estimatedEPS);
        const pe = this.num(cpi.pe ?? cpi.sectorPE);
        if (eps == null && pe == null) continue;
        await this.prisma.priceBar.updateMany({
          where: { instrumentId: s.id, tradeDate },
          data: {
            ...(eps != null ? { eps } : {}),
            ...(pe != null ? { pe } : {}),
          },
        });
      } catch {
        // نادیده گرفتن خطای تک‌نماد
      }
    }
  }

  private async ingestOptions(tradeDate: Date) {
    try {
      const data = await this.fetchJson(
        'https://webgw.tse.ir/InstrumentProvider/api/v1/MarketWatch/MarketWatchOption/fa',
      );
      const items: unknown[] = data?.Items ?? data?.items ?? [];
      for (const item of items as Record<string, unknown>[]) {
        const symbol = String(item.namad ?? item.lVal18AFC ?? item.instrumentName ?? item.symbol ?? '').trim();
        const nameFa = String(
          item.name ?? item.lVal30 ?? item.companyNamePersian ?? symbol,
        ).trim();
        if (!symbol) continue;
        const lastPrice = this.num(item.akharinGheymat ?? item.pl ?? item.lastPrice);
        const instrument = await this.prisma.instrument.upsert({
          where: { symbol_assetType: { symbol, assetType: AssetType.OPTION } },
          create: {
            symbol,
            nameFa,
            assetType: AssetType.OPTION,
            meta: item as Prisma.InputJsonValue,
          },
          update: { nameFa, meta: item as Prisma.InputJsonValue, isActive: true },
        });
        await this.prisma.priceBar.upsert({
          where: { instrumentId_tradeDate: { instrumentId: instrument.id, tradeDate } },
          create: {
            instrumentId: instrument.id,
            tradeDate,
            lastPrice,
            closePrice: lastPrice,
            raw: item as Prisma.InputJsonValue,
          },
          update: {
            lastPrice,
            closePrice: lastPrice,
            raw: item as Prisma.InputJsonValue,
          },
        });
      }
    } catch (e) {
      this.logger.warn(`دریافت اختیار معامله ناموفق: ${(e as Error).message}`);
    }
  }

  private async ensureDepositInstrument(tradeDate: Date) {
    const instrument = await this.prisma.instrument.upsert({
      where: { symbol_assetType: { symbol: 'سپرده', assetType: AssetType.DEPOSIT } },
      create: {
        symbol: 'سپرده',
        nameFa: 'سپرده بانکی ریالی',
        assetType: AssetType.DEPOSIT,
        meta: { annualRatePct: 20 },
      },
      update: {},
    });
    const rate = 20;
    await this.prisma.priceBar.upsert({
      where: { instrumentId_tradeDate: { instrumentId: instrument.id, tradeDate } },
      create: {
        instrumentId: instrument.id,
        tradeDate,
        lastPrice: 1,
        closePrice: 1,
        pe: rate,
        raw: { annualRatePct: rate },
      },
      update: { pe: rate, raw: { annualRatePct: rate } },
    });
  }

  private detectAssetType(symbol: string, row: Record<string, unknown>): AssetType {
    const name = String(row.lVal30 ?? row.name ?? '');
    if (GOLD_SYMBOLS.has(symbol) || name.includes('طلا')) {
      return AssetType.GOLD_ETF;
    }
    if (row.assetHint === 'etf') {
      return AssetType.FUND;
    }
    return AssetType.STOCK;
  }

  private async fetchHistoryInDay(dEven: string): Promise<IngestRow[]> {
    try {
      const data = await this.fetchJson(
        `https://cdn.tsetmc.com/api/ClosingPrice/GetInstrmentsHistoryInDay/${dEven}`,
      );
      const list =
        data?.closingPriceDailyHistoryWithInstDetails ??
        data?.closingPriceDaily ??
        data?.instrumentClosing ??
        [];
      if (Array.isArray(list) && list.length) {
        return list.map((x: Record<string, unknown>) => {
          const inst = (x.instrument as Record<string, unknown>) ?? {};
          return {
            ...x,
            insCode: x.insCode ?? inst.insCode,
            lVal18AFC: inst.lVal18AFC ?? x.lVal18AFC,
            lVal30: inst.lVal30 ?? x.lVal30,
          };
        });
      }
      this.logger.warn(`HistoryInDay ${dEven}: بدون ردیف`);
    } catch (e) {
      this.logger.warn(`HistoryInDay ${dEven} ناموفق: ${(e as Error).message}`);
    }
    return [];
  }

  private async fetchMarketWatchLegacy(): Promise<IngestRow[]> {
    try {
      const res = await fetch('https://old.tsetmc.com/tsev2/data/MarketWatchInit.aspx?h=0&r=0', {
        headers: FETCH_HEADERS,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (/مسدود|دسترسی شما|request rejected|access denied/i.test(text)) {
        throw new Error('پاسخ مسدود/WAF');
      }
      // فرمت: بخش‌ها با @ جدا؛ بخش نمادها معمولاً index 2
      const parts = text.split('@');
      const body = parts[2] ?? parts[1] ?? '';
      const rows: IngestRow[] = [];
      for (const line of body.split(';')) {
        if (!line.trim()) continue;
        const f = line.split(',');
        if (f.length < 5) continue;
        rows.push({
          insCode: f[0],
          lVal18AFC: f[2],
          lVal30: f[3],
          pl: Number(f[7]) || null,
          pc: Number(f[6]) || null,
          eps: Number(f[14]) || null,
          pe: Number(f[15]) || null,
          qTotTran5J: Number(f[9]) || null,
        });
      }
      return rows;
    } catch (e) {
      this.logger.error(`MarketWatch legacy ناموفق: ${(e as Error).message}`);
      return [];
    }
  }

  private async fetchJson(url: string) {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const text = await res.text();
    if (/مسدود|دسترسی شما|request rejected|access denied/i.test(text)) {
      throw new Error(`blocked: ${url}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`non-json: ${url}`);
    }
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v)
      .trim()
      .replace(/,/g, '')
      .replace(/٫/g, '.')
      .replace(/[−–]/g, '-');
    if (s.endsWith('-') && !s.startsWith('-')) s = `-${s.slice(0, -1)}`;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
}
