import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { AiQuotaExceededException, AiUsageService } from '../ai-usage/ai-usage.service';
import {
  foldFa,
  isTehranMarketScoped,
  MARKET_CHAT_REFUSE_FA,
  tokenizeMarketQuestion,
  wantsEqualWeightIndex,
  wantsTotalIndex,
} from './tehran-chat';
import { isRefreshSlot, readRefreshSchedule } from '../content-refresh/refresh-schedule';
import { tehranTimeParts } from '../news/tehran-date';
import {
  buildOptionBoard,
  describeQuote,
  listValuableOptions,
  marketNumber,
  optionBoardForPrompt,
  optionMetaExpired,
  optionTradePrice,
  parseOptionMeta,
  tehranJalaliCompact,
  valuableOptionsForUnderlying,
  type BoardSource,
  type OptionBoard,
  type QueueSide,
  type ValuableOption,
} from './option-board';
import {
  LIVE_SESSION_END_MIN,
  LIVE_SESSION_START_MIN,
  buildEquivalent,
  liveQueue,
  pickEquivalentCandidates,
  readBestLimit,
  readLastTrade,
  readPriceLimits,
  type LiveBook,
  type LiveEquivalent,
} from './live-equivalents';
import { symbolKey } from '../portfolios/stock-signals';
import {
  brsEndpoint,
  readBrsApiAccess,
  readBrsApiPublic,
  redactBrsUrl,
  saveBrsApiConfig as persistBrsApiConfig,
} from './brs-api';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** اختیار با روز ماندهٔ صفر یا کمتر در فهرست‌ها و پیشنهادها نیاید. */
export function excludeExpiredOptions(): Prisma.InstrumentWhereInput {
  return {
    NOT: {
      AND: [{ assetType: AssetType.OPTION }, { meta: { path: ['daysLeft'], lte: 0 } }],
    },
  };
}

const expiredNameIds = new Map<string, string[]>();

/** اختیارهایی که تاریخ سررسید عنوانشان گذشته است، حتی اگر روز ماندهٔ ذخیره‌شده مثبت باشد. */
export async function nameExpiredOptionIds(prisma: PrismaService): Promise<string[]> {
  const today = tehranJalaliCompact();
  const cached = expiredNameIds.get(today);
  if (cached) return cached;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "Instrument"
    WHERE "assetType" = 'OPTION'::"AssetType"
      AND substring(
        translate(btrim("nameFa"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
        from '([12][0-9]{7})$'
      ) IS NOT NULL
      AND substring(
        translate(btrim("nameFa"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
        from '([12][0-9]{7})$'
      ) <= ${today}
  `;
  const ids = rows.map((row) => row.id);
  expiredNameIds.clear();
  expiredNameIds.set(today, ids);
  return ids;
}

export async function visibleInstrumentsWhere(prisma: PrismaService): Promise<Prisma.InstrumentWhereInput> {
  const ids = await nameExpiredOptionIds(prisma);
  if (!ids.length) return excludeExpiredOptions();
  return { AND: [excludeExpiredOptions(), { id: { notIn: ids } }] };
}

function bookVolumeSql(prefix: 'qd' | 'qo'): Prisma.Sql {
  const cols = [1, 2, 3, 4, 5].map((level) => `${prefix}${level}`);
  const missing = Prisma.join(
    cols.map((col) => Prisma.sql`b.${Prisma.raw(`"${col}"`)} IS NULL`),
    ' AND ',
  );
  const levels = cols.map(
    (col) => Prisma.sql`
      CASE
        WHEN COALESCE(b.${Prisma.raw(`"${col}"`)}, '') ~ '^[0-9]+([.][0-9]+)?$'
        THEN b.${Prisma.raw(`"${col}"`)}::double precision
        ELSE 0
      END
    `,
  );
  return Prisma.sql`CASE WHEN ${missing} THEN NULL ELSE ${Prisma.join(levels, ' + ')} END`;
}

function queueKeySelect(): Prisma.Sql {
  const keys = ['qd1', 'qd2', 'qd3', 'qd4', 'qd5', 'qo1', 'qo2', 'qo3', 'qo4', 'qo5'];
  return Prisma.join(
    keys.map((key) => Prisma.sql`raw->>${key} AS ${Prisma.raw(`"${key}"`)}`),
    ', ',
  );
}

function listedOptionSql(): Prisma.Sql {
  const today = tehranJalaliCompact();
  return Prisma.sql`
    NOT (
      i."assetType" = 'OPTION'::"AssetType"
      AND (
        (
          jsonb_typeof(i.meta->'daysLeft') = 'number'
          AND (i.meta->>'daysLeft')::double precision <= 0
        )
        OR (
          substring(
            translate(btrim(i."nameFa"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
            from '([12][0-9]{7})$'
          ) IS NOT NULL
          AND substring(
            translate(btrim(i."nameFa"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
            from '([12][0-9]{7})$'
          ) <= ${today}
        )
      )
    )
  `;
}

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

/** عدد محاسبه‌شده، نه نماد بورس. insCode ساختگی است تا با کد TSETMC قاطی نشود. */
const USD_MARKET_INDICES = [
  {
    key: 'totalUsd' as const,
    baseKey: 'total' as const,
    insCode: 'USD-TEDPIX',
    symbol: 'CALC-TOTAL-USD',
    nameFa: 'شاخص کل دلاری',
    unit: 'usd' as const,
  },
  {
    key: 'equalWeightUsd' as const,
    baseKey: 'equalWeight' as const,
    insCode: 'USD-TESWEQ',
    symbol: 'CALC-EQUAL-USD',
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

/** شاخص همان روز ÷ قیمت دلار همان روز. usdIrr به ریال است و قیمت رایج دلار به تومان است. */
function indexPointsToUsd(points: number, usdIrr: number): number | null {
  const toman = usdIrr / 10;
  if (!(points > 0) || !(toman > 0)) return null;
  return Math.round((points / toman) * 100) / 100;
}

/** پنجشنبه و جمعه بورس تهران تعطیل است */
function isTehranWeekend(dEven: string): boolean {
  const dow = dEvenToDate(dEven).getUTCDay();
  return dow === 4 || dow === 5;
}

/** حداکثر چند روز معاملاتی در هر به‌روزرسانی (جلوگیری از پیمایش سال‌ها) */
const MAX_INGEST_TRADING_DAYS = 5;
const MAX_LOOKBACK_CALENDAR_DAYS = 14;

/** پیش‌گشایش ۸:۳۰ و شروع معاملات ۹:۰۰ تهران */
/** کد عددی نماد در tsetmc؛ شناسه‌های ساختگی مثل USD-TEDPIX رد می‌شوند. */
const TSETMC_CODE = /^\d{5,20}$/;
const LIVE_FETCH_TIMEOUT_MS = 8_000;
/** بازدیدهای پشت‌سرهم یک صفحه، tsetmc را دوباره صدا نمی‌زنند. */
const LIVE_EQUIVALENT_TTL_MS = 30_000;

type LiveEquivalentsView = {
  inSession: boolean;
  hasOptions: boolean;
  /** false یعنی tsetmc جواب نداد و قیمت‌ها ذخیره‌شده است. */
  live: boolean;
  queue: QueueSide | null;
  spot: number | null;
  noteFa: string;
  disclaimerFa: string;
  checkedAt: string;
  items: LiveEquivalent[];
};
const MARKET_PREOPEN_MIN = 8 * 60 + 30;
const MARKET_OPEN_MIN = 9 * 60;

/**
 * ارقام لحظه‌ای منبع مال کدام روز معاملاتی است: امروز اگر معاملات شروع شده،
 * وگرنه آخرین روز معاملاتی قبل (بعد از نیمه‌شب، پیش از گشایش، پنجشنبه و جمعه).
 */
function snapshotTradingDEven(): string {
  const now = tehranNow();
  const today = toDEven(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const opened = !isTehranWeekend(today) && nowMin >= MARKET_OPEN_MIN;
  for (let back = opened ? 0 : 1; back <= MAX_LOOKBACK_CALENDAR_DAYS; back++) {
    const day = shiftDEven(today, back);
    if (!isTehranWeekend(day)) return day;
  }
  return today;
}

type IngestRow = Record<string, unknown>;

@Injectable()
export class MarketService implements OnModuleInit {
  private readonly logger = new Logger(MarketService.name);
  private ingestInFlight = false;
  private readonly liveEquivalentCache = new Map<string, { at: number; value: LiveEquivalentsView }>();
  /** بعد از تلاش ناموفق، تا این لحظه دوباره API بورس صدا زده نمی‌شود */
  private marketRetryAfter = 0;
  private optionsRefresh: { running: boolean; messageFa: string; error: boolean } = {
    running: false,
    messageFa: '',
    error: false,
  };
  private indexSnapshotInFlight: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly aiUsage: AiUsageService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.catchUpMarketIfDue();
    }, 180_000);
  }

  /**
   * هر دقیقه فقط ساعت تهران را با تنظیم ادمین مقایسه می‌کند.
   * باز شدن صفحه این را صدا نمی‌زند و خودش API بورس را نمی‌خواند.
   */
  @Cron('* * * * *', { timeZone: 'Asia/Tehran', name: 'market-ingest-tick' })
  async scheduledIngest() {
    await this.syncMarketIfDue(true);
  }

  /** اگر سرویس بعد از ساعت مقرر بالا بیاید و میلهٔ سهام همان روز نباشد، همان به‌روزرسانی زمان‌بندی‌شده را یک‌بار جبران می‌کند. */
  private async catchUpMarketIfDue() {
    await this.syncMarketIfDue(false);
  }

  /**
   * سر ساعت تنظیم‌شده یک‌بار می‌خواند. اگر میلهٔ سهامِ آخرین روز معاملاتی ذخیره نشده باشد
   * (خطای منبع، خاموش بودن سرویس در همان ساعت) خودش جبران می‌کند، حتی بعد از نیمه‌شب تا پیش از گشایش فردا.
   */
  private async syncMarketIfDue(fromClock: boolean) {
    const schedule = await readRefreshSchedule(this.prisma);
    const now = tehranTimeParts();
    const nowMin = now.hour * 60 + now.minute;
    const atMin = schedule.marketHour * 60 + schedule.marketMinute;

    const slot = isRefreshSlot(nowMin, atMin, true);
    const label = `${String(schedule.marketHour).padStart(2, '0')}:${String(schedule.marketMinute).padStart(2, '0')}`;
    if (fromClock && slot === 'exact') {
      if (this.ingestInFlight || Date.now() < this.marketRetryAfter) return;
      this.logger.log(`بروزرسانی زمان‌بندی‌شده بازار (${label} تهران)`);
      this.marketRetryAfter = Date.now() + 15 * 60 * 1000;
      this.beginIngest(false);
      return;
    }

    const today = toDEven();
    const day = snapshotTradingDEven();
    const sameDay = day === today;
    // نوبت زمان‌بندی همین روز معاملاتی هنوز نرسیده است
    if (sameDay && (atMin < MARKET_OPEN_MIN || nowMin < atMin)) return;
    // بین پیش‌گشایش و شروع معاملات ارقام منبع نه مال دیروز است نه امروز
    if (!sameDay && !isTehranWeekend(today) && nowMin >= MARKET_PREOPEN_MIN) return;

    const retrySlot = fromClock && slot === 'retry';
    const blocked = this.ingestInFlight || Date.now() < this.marketRetryAfter;
    if (blocked && !retrySlot) return;

    const hasStocks = await this.hasBarsForTradingDay(day);
    if (hasStocks) {
      if (retrySlot) {
        await this.ingestOptionsIfMissing(day);
        await this.ensureLatestIndexValues(true);
      }
      return;
    }
    if (blocked) return;

    this.logger.log(
      fromClock
        ? `میلهٔ سهام روز معاملاتی ${day} نیست؛ تلاش دوباره (نوبت ${label} تهران)`
        : `پس از راه‌اندازی: نوبت ${label} گذشته و میلهٔ سهام روز معاملاتی ${day} نیست`,
    );
    // همان شب هر ۱۵ دقیقه؛ بعد از نیمه‌شب و روز تعطیل هر ساعت
    this.marketRetryAfter = Date.now() + (sameDay ? 15 : 60) * 60 * 1000;
    this.beginIngest(false);
  }

  private barsSeen: { day: string; at: number } | null = null;

  /** میلهٔ شاخص یا سپرده کافی نیست؛ باید خود سهام، صندوق یا طلای بورسی همان روز ذخیره شده باشد. */
  private async hasBarsForTradingDay(day: string): Promise<boolean> {
    // کرون هر دقیقه می‌پرسد؛ جواب مثبت ده دقیقه معتبر می‌ماند
    if (this.barsSeen?.day === day && Date.now() - this.barsSeen.at < 10 * 60 * 1000) return true;
    const count = await this.prisma.priceBar.count({
      where: {
        tradeDate: dEvenToDate(day),
        instrument: {
          assetType: { in: [AssetType.STOCK, AssetType.GOLD_ETF, AssetType.FUND] },
        },
        OR: [{ lastPrice: { gt: 0 } }, { closePrice: { gt: 0 } }],
      },
    });
    this.barsSeen = count > 0 ? { day, at: Date.now() } : null;
    return count > 0;
  }

  /** میلهٔ سهام مانع تکرار کل اینجست است؛ اختیار اگر برای همان روز نباشد جدا خوانده می‌شود */
  private async ingestOptionsIfMissing(day: string) {
    if (this.ingestInFlight) return;
    const count = await this.prisma.priceBar.count({
      where: {
        tradeDate: dEvenToDate(day),
        instrument: { assetType: AssetType.OPTION },
        OR: [{ lastPrice: { gt: 0 } }, { closePrice: { gt: 0 } }],
      },
    });
    if (count > 0) return;
    this.logger.log('میلهٔ سهام هست ولی اختیار معامله برای این روز نیست');
    this.ingestInFlight = true;
    void this.finishOptionsOnly(day);
  }

  private async finishOptionsOnly(dEven: string) {
    try {
      const saved = await this.ingestOptions(dEvenToDate(dEven));
      this.logger.log(`اختیار معامله ذخیره شد: ${saved}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`اینجست اختیار ناموفق: ${message}`);
      await this.recordMarketError(e);
    } finally {
      this.ingestInFlight = false;
    }
  }

  /** مرتب‌سازی روی EPS یا P/E آخرین میلهٔ هر نماد. مقدار خالی آخر می‌ماند. */
  private async instrumentIdsByLatestRatio(input: {
    q?: string;
    assetType?: AssetType;
    sort: 'eps' | 'pe';
    dir: 'asc' | 'desc';
    skip: number;
    take: number;
  }): Promise<string[]> {
    const metric =
      input.sort === 'eps'
        ? input.dir === 'asc'
          ? Prisma.sql`latest.eps ASC NULLS LAST`
          : Prisma.sql`latest.eps DESC NULLS LAST`
        : input.dir === 'asc'
          ? Prisma.sql`latest.pe ASC NULLS LAST`
          : Prisma.sql`latest.pe DESC NULLS LAST`;
    const assetSql = input.assetType
      ? Prisma.sql`AND i."assetType" = ${input.assetType}::"AssetType"`
      : Prisma.sql`AND i."assetType" <> 'INDEX'::"AssetType"`;
    const symbolSql = input.q
      ? Prisma.sql`AND i.symbol LIKE ${`%${input.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`} ESCAPE '\\'`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id
      FROM "Instrument" i
      LEFT JOIN LATERAL (
        SELECT pb.eps, pb.pe
        FROM "PriceBar" pb
        WHERE pb."instrumentId" = i.id
        ORDER BY pb."tradeDate" DESC
        LIMIT 1
      ) latest ON true
      WHERE i."isActive" = true
      AND ${listedOptionSql()}
      ${assetSql}
      ${symbolSql}
      ORDER BY ${metric}, i.symbol ASC
      LIMIT ${input.take} OFFSET ${input.skip}
    `;
    return rows.map((row) => row.id);
  }

  async listLatest(params: {
    q?: string;
    assetType?: AssetType;
    take?: number;
    page?: number;
    sort?: string;
    dir?: string;
  }) {
    const take = Math.min(Math.max(params.take ?? 20, 1), 100);
    const page = Math.max(params.page ?? 1, 1);
    const skip = (page - 1) * take;
    const sort = params.sort === 'eps' || params.sort === 'pe' ? params.sort : undefined;
    const dir = params.dir === 'asc' ? 'asc' : 'desc';
    const where = {
      isActive: true,
      assetType: params.assetType ? params.assetType : { not: AssetType.INDEX },
      ...(params.q ? { symbol: { contains: params.q } } : {}),
      ...(await visibleInstrumentsWhere(this.prisma)),
    };

    const orderedIds = sort
      ? await this.instrumentIdsByLatestRatio({
          q: params.q,
          assetType: params.assetType,
          sort,
          dir,
          skip,
          take,
        })
      : null;
    const [total, instruments, lastInstrument, lastBar] = await Promise.all([
      this.prisma.instrument.count({ where }),
      this.prisma.instrument.findMany({
        where: orderedIds ? { id: { in: orderedIds } } : where,
        skip: orderedIds ? undefined : skip,
        take: orderedIds ? undefined : take,
        orderBy: orderedIds ? undefined : { symbol: 'asc' },
        include: {
          priceBars: {
            orderBy: { tradeDate: 'desc' },
            take: 1,
            select: {
              lastPrice: true,
              closePrice: true,
              eps: true,
              pe: true,
              volume: true,
              tradeDate: true,
            },
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

    const ordered = orderedIds
      ? orderedIds
          .map((id) => instruments.find((row) => row.id === id))
          .filter((row): row is (typeof instruments)[number] => Boolean(row))
      : instruments;
    const items = ordered.map((i) => {
      const bar = i.priceBars[0];
      const source: BoardSource = {
        id: i.id,
        symbol: i.symbol,
        nameFa: i.nameFa,
        assetType: i.assetType,
        lastPrice: bar?.lastPrice ?? null,
        closePrice: bar?.closePrice ?? null,
        volume: bar?.volume ?? null,
        raw: null,
        meta: i.meta,
      };
      const extra = describeQuote(source);
      return {
        id: i.id,
        symbol: i.symbol,
        nameFa: i.nameFa,
        assetType: i.assetType,
        insCode: i.insCode,
        queue: extra.queue,
        queueFa: extra.queueFa,
        optionSideFa: extra.optionSideFa,
        underlyingSymbol: extra.underlyingSymbol,
        strike: extra.strike,
        last: bar
          ? {
              lastPrice: bar.lastPrice,
              closePrice: bar.closePrice,
              eps: bar.eps,
              pe: bar.pe,
              volume: bar.volume,
              tradeDate: bar.tradeDate,
            }
          : null,
      };
    });

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

  async getUnderlyingOptions(id: string) {
    const pack = await this.underlyingOptionPack(id);
    if (!pack) return null;
    return {
      symbol: pack.symbol,
      spot: pack.spot,
      hasOptions: pack.hasOptions,
      disclaimerFa: pack.disclaimerFa,
      inflationPct: pack.inflationPct,
      items: pack.items,
    };
  }

  /**
   * فقط شنبه تا چهارشنبه، ۹:۰۰ تا ۱۲:۳۰ تهران: صف زندهٔ سهم از tsetmc و اختیارهای نزدیک سررسیدی
   * که خریدشان جای خرید یا فروش خود سهم را می‌گیرد. بیرون از این بازه tsetmc صدا زده نمی‌شود.
   */
  async getLiveEquivalents(id: string) {
    const now = tehranNow();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const inSession =
      !isTehranWeekend(toDEven(now)) && nowMin >= LIVE_SESSION_START_MIN && nowMin <= LIVE_SESSION_END_MIN;
    const idle: LiveEquivalentsView = {
      inSession,
      hasOptions: false,
      live: false,
      queue: null,
      spot: null,
      noteFa: '',
      disclaimerFa: '',
      checkedAt: new Date().toISOString(),
      items: [],
    };
    if (!inSession) {
      const exists = await this.prisma.instrument.findUnique({ where: { id }, select: { id: true } });
      return exists ? idle : null;
    }
    const cached = this.liveEquivalentCache.get(id);
    if (cached && Date.now() - cached.at < LIVE_EQUIVALENT_TTL_MS) return cached.value;

    const pack = await this.underlyingOptionPack(id);
    if (!pack) return null;
    if (!pack.hasOptions) return idle;

    const board = await this.readLiveBoard(pack.insCode);
    const queue = board?.queue ?? null;
    const spot = board?.last ?? pack.spot;
    let items: LiveEquivalent[] = [];
    if (spot != null && spot > 0) {
      const candidates = pickEquivalentCandidates(pack.items, spot, queue);
      const built = await Promise.all(
        candidates.map(async (option) => {
          const code = pack.optionCodes.get(option.id);
          // اگر خود سهم از tsetmc خوانده نشد، برای هر اختیار هم دوباره منتظر همان خطا نمی‌مانیم.
          const book = board && code ? await this.readLiveBook(code) : null;
          if (book) {
            // خریدار بهترین عرضه را می‌پردازد؛ بدون فروشنده، این اختیار الان قابل خرید نیست.
            if (book.askPrice == null || book.askVolume == null) return null;
            return buildEquivalent(option, spot, book.askPrice, 'live', book.askVolume);
          }
          if (option.premium == null || !(option.premium > 0)) return null;
          return buildEquivalent(option, spot, option.premium, 'stored', null);
        }),
      );
      items = built
        .filter((row): row is LiveEquivalent => row != null)
        .sort((a, b) => a.gapPct - b.gapPct || a.daysLeft - b.daysLeft);
    }
    const noteFa = !board
      ? 'خواندن زنده از tsetmc در این لحظه ممکن نشد؛ وضعیت صف نامشخص است و قیمت‌ها آخرین قیمت ذخیره‌شده است.'
      : queue === 'buy'
        ? 'سهم الان صف خرید است و خرید خود سهم عملاً ممکن نیست. اختیارهای خرید زیر، اگر در سررسید اعمال شوند، همان سهم را می‌دهند.'
        : queue === 'sell'
          ? 'سهم الان صف فروش است و فروش خود سهم عملاً ممکن نیست. اختیارهای فروش زیر، اگر در سررسید اعمال شوند، همان سهم را می‌فروشند.'
          : 'سهم الان صف خرید یا فروش نیست. اختیار خرید جای خرید سهم و اختیار فروش جای فروش سهم را می‌گیرد.';
    const value: LiveEquivalentsView = {
      inSession: true,
      hasOptions: true,
      live: Boolean(board),
      queue,
      spot,
      noteFa,
      disclaimerFa:
        'این فهرست از قیمت همین لحظه حساب شده و توصیهٔ قطعی معامله نیست. کارمزد در آن نیامده و اعمال اختیار فقط در سررسید ممکن است.',
      checkedAt: new Date().toISOString(),
      items,
    };
    if (this.liveEquivalentCache.size > 300) this.liveEquivalentCache.clear();
    this.liveEquivalentCache.set(id, { at: Date.now(), value });
    return value;
  }

  /** صف و آخرین قیمت سهم از tsetmc. null یعنی خواندن ناموفق بود یا کد نماد نداریم. */
  private async readLiveBoard(
    insCode: string | null,
  ): Promise<{ queue: QueueSide | null; last: number | null } | null> {
    if (!insCode || !TSETMC_CODE.test(insCode)) return null;
    try {
      const [bookData, infoData, priceData] = await Promise.all([
        this.fetchJson(`https://cdn.tsetmc.com/api/BestLimits/${insCode}`, LIVE_FETCH_TIMEOUT_MS),
        this.fetchJson(`https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/${insCode}`, LIVE_FETCH_TIMEOUT_MS),
        this.fetchJson(
          `https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/${insCode}`,
          LIVE_FETCH_TIMEOUT_MS,
        ).catch(() => null),
      ]);
      const book = readBestLimit(bookData);
      const limits = readPriceLimits(infoData);
      if (!book || !limits) return null;
      return { queue: liveQueue(book, limits), last: readLastTrade(priceData) };
    } catch (e) {
      this.logger.warn(`صف زندهٔ tsetmc (${insCode}): ${(e as Error).message}`);
      return null;
    }
  }

  private async readLiveBook(insCode: string): Promise<LiveBook | null> {
    if (!TSETMC_CODE.test(insCode)) return null;
    try {
      return readBestLimit(
        await this.fetchJson(`https://cdn.tsetmc.com/api/BestLimits/${insCode}`, LIVE_FETCH_TIMEOUT_MS),
      );
    } catch {
      return null;
    }
  }

  private async underlyingOptionPack(id: string) {
    const inst = await this.prisma.instrument.findUnique({
      where: { id },
      include: {
        priceBars: {
          orderBy: { tradeDate: 'desc' },
          take: 1,
          select: { lastPrice: true, closePrice: true, volume: true },
        },
      },
    });
    if (!inst) return null;
    const spot = inst.priceBars[0]?.lastPrice ?? inst.priceBars[0]?.closePrice ?? null;
    const eligible =
      inst.assetType === AssetType.STOCK ||
      inst.assetType === AssetType.GOLD_ETF ||
      inst.assetType === AssetType.FUND;
    if (!eligible) {
      return {
        symbol: inst.symbol,
        insCode: inst.insCode,
        spot,
        hasOptions: false,
        disclaimerFa: '',
        inflationPct: null,
        items: [] as ValuableOption[],
        optionCodes: new Map<string, string>(),
      };
    }
    const options = await this.prisma.$queryRaw<
      Array<{
        id: string;
        symbol: string;
        nameFa: string;
        meta: unknown;
        lastPrice: number | null;
        closePrice: number | null;
        volume: number | null;
        baseId: string | null;
        optionCode: string | null;
        buyQueueVolume: number | null;
        sellQueueVolume: number | null;
      }>
    >`
      SELECT i.id, i.symbol, i."nameFa", i.meta,
             b."lastPrice", b."closePrice", b.volume,
             NULLIF(b.raw->>'base_id', '') AS "baseId",
             COALESCE(i."insCode", NULLIF(b.raw->>'id', '')) AS "optionCode",
             ${bookVolumeSql('qd')} AS "buyQueueVolume",
             ${bookVolumeSql('qo')} AS "sellQueueVolume"
      FROM "Instrument" i
      LEFT JOIN LATERAL (
        SELECT "lastPrice", "closePrice", volume, raw, ${queueKeySelect()}
        FROM "PriceBar"
        WHERE "instrumentId" = i.id
        ORDER BY "tradeDate" DESC
        LIMIT 1
      ) b ON true
      WHERE i."isActive" = true
        AND i."assetType" = 'OPTION'::"AssetType"
        AND ${listedOptionSql()}
    `;
    const inflationPct = await this.latestInflationPct();
    const bar = inst.priceBars[0];
    const valued = valuableOptionsForUnderlying(
      {
        id: inst.id,
        symbol: inst.symbol,
        nameFa: inst.nameFa,
        assetType: inst.assetType,
        lastPrice: bar?.lastPrice ?? null,
        closePrice: bar?.closePrice ?? null,
        volume: bar?.volume ?? null,
        raw: null,
        meta: inst.meta,
      },
      inst.insCode,
      options.map((row) => {
        const meta =
          row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
            ? { ...(row.meta as Record<string, unknown>) }
            : {};
        if (row.baseId) meta.base_id = row.baseId;
        return {
          id: row.id,
          symbol: row.symbol,
          nameFa: row.nameFa,
          assetType: 'OPTION' as const,
          lastPrice: row.lastPrice,
          closePrice: row.closePrice,
          volume: row.volume,
          buyQueueVolume: row.buyQueueVolume,
          sellQueueVolume: row.sellQueueVolume,
          raw: null,
          meta,
        };
      }),
      inflationPct,
    );
    const optionCodes = new Map<string, string>();
    for (const row of options) {
      if (row.optionCode) optionCodes.set(row.id, row.optionCode);
    }
    return {
      symbol: inst.symbol,
      insCode: inst.insCode,
      spot,
      hasOptions: valued.hasOptions,
      disclaimerFa: 'این فهرست از قیمت ذخیره‌شدهٔ اختیار و دارایی پایه حساب شده و توصیهٔ قطعی معامله نیست.',
      inflationPct,
      items: valued.items,
      optionCodes,
    };
  }

  /**
   * صندوق‌هایی که این نماد را در آخرین گزارش ماهانهٔ ثبت‌شده‌شان دارند، با سهم نماد از دارایی صندوق.
   * فقط از گزارش‌های بارگذاری‌شده در دیتابیس؛ صندوقی که گزارشش ثبت نشده اینجا نمی‌آید.
   */
  async getFundHolders(id: string) {
    const inst = await this.prisma.instrument.findUnique({
      where: { id },
      select: { symbol: true, nameFa: true, assetType: true },
    });
    if (!inst) return null;
    if (inst.assetType === AssetType.OPTION || inst.assetType === AssetType.INDEX) return { items: [] };

    const reports = await this.prisma.fundReport.findMany({
      where: {
        fundDefinitionId: { not: null },
        fundDefinition: { isActive: true },
        reportYear: { not: null },
        reportMonthNum: { not: null },
        analysisStatus: 'done',
      },
      select: {
        id: true,
        fundDefinitionId: true,
        reportYear: true,
        reportMonthNum: true,
        fundDefinition: { select: { nameFa: true, symbolCode: true } },
      },
    });
    const monthIndex = (r: { reportYear: number | null; reportMonthNum: number | null }) =>
      (r.reportYear ?? 0) * 12 + (r.reportMonthNum ?? 0);
    const latestByFund = new Map<string, (typeof reports)[number]>();
    for (const report of reports) {
      const fundId = report.fundDefinitionId;
      if (!fundId) continue;
      const current = latestByFund.get(fundId);
      if (!current || monthIndex(report) > monthIndex(current)) latestByFund.set(fundId, report);
    }
    if (!latestByFund.size) return { items: [] };

    const latest = [...latestByFund.values()];
    const holdings = await this.prisma.fundHolding.findMany({
      where: { fundReportId: { in: latest.map((r) => r.id) }, action: 'HELD' },
      select: { fundReportId: true, symbol: true, nameFa: true, weightPct: true, amountRial: true, quantity: true },
    });
    // نماد گزارش صندوق دست‌نویس مدل است؛ با همان کلید نرمال‌شدهٔ پیشنهاد سبد تطبیق می‌دهیم.
    const wanted = new Set([symbolKey(inst.symbol), symbolKey(inst.nameFa)].filter(Boolean));
    const best = new Map<string, (typeof holdings)[number]>();
    for (const row of holdings) {
      if (!wanted.has(symbolKey(row.symbol)) && !wanted.has(symbolKey(row.nameFa))) continue;
      const current = best.get(row.fundReportId);
      if (!current || (row.weightPct ?? 0) > (current.weightPct ?? 0)) best.set(row.fundReportId, row);
    }
    const matched = latest.filter((report) => best.has(report.id));
    if (!matched.length) return { items: [] };

    // اگر خود صندوق در بازار نماد دارد، صفحه به آن پیوند می‌دهد.
    const codes = matched
      .map((report) => report.fundDefinition?.symbolCode?.trim())
      .filter((code): code is string => Boolean(code));
    const listed = codes.length
      ? await this.prisma.instrument.findMany({
          where: { symbol: { in: codes }, isActive: true },
          select: { id: true, symbol: true },
        })
      : [];
    const instrumentBySymbol = new Map(listed.map((row) => [symbolKey(row.symbol), row.id]));

    const items = matched
      .map((report) => {
        const row = best.get(report.id)!;
        const symbolCode = report.fundDefinition?.symbolCode?.trim() || null;
        return {
          fundDefinitionId: report.fundDefinitionId!,
          fundNameFa: report.fundDefinition?.nameFa ?? '',
          fundSymbol: symbolCode,
          fundInstrumentId: symbolCode ? instrumentBySymbol.get(symbolKey(symbolCode)) ?? null : null,
          weightPct: row.weightPct,
          amountRial: row.amountRial,
          quantity: row.quantity,
          reportYear: report.reportYear,
          reportMonthNum: report.reportMonthNum,
        };
      })
      .sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1) || (b.amountRial ?? 0) - (a.amountRial ?? 0));
    return { items };
  }

  private async latestInflationPct(): Promise<number | null> {
    const inflation = await this.prisma.macroSnapshot.findFirst({
      where: { inflationPct: { not: null } },
      orderBy: { asOfDate: 'desc' },
      select: { inflationPct: true },
    });
    return inflation?.inflationPct != null && Number.isFinite(inflation.inflationPct)
      ? inflation.inflationPct
      : null;
  }

  async getValuableOptions() {
    const rows = await this.latestOptionBoardPrices();
    const inflationPct = await this.latestInflationPct();
    return {
      disclaimerFa: 'این فهرست از قیمت ذخیره‌شدهٔ اختیار و دارایی پایه حساب شده و توصیهٔ قطعی معامله نیست.',
      inflationPct,
      items: listValuableOptions(rows, inflationPct),
    };
  }

  /** آخرین قیمت بدون ستون خام؛ خواندن خام همهٔ نمادها پاسخ را سنگین و قطع می‌کند. */
  private async latestOptionBoardPrices() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        symbol: string;
        nameFa: string;
        assetType: string;
        meta: unknown;
        lastPrice: number | null;
        closePrice: number | null;
        volume: number | null;
        buyQueueVolume: number | null;
        sellQueueVolume: number | null;
      }>
    >`
      SELECT i.id, i.symbol, i."nameFa", i."assetType"::text AS "assetType", i.meta,
             b."lastPrice", b."closePrice", b.volume,
             ${bookVolumeSql('qd')} AS "buyQueueVolume",
             ${bookVolumeSql('qo')} AS "sellQueueVolume"
      FROM "Instrument" i
      LEFT JOIN LATERAL (
        SELECT "lastPrice", "closePrice", volume, ${queueKeySelect()}
        FROM "PriceBar"
        WHERE "instrumentId" = i.id
        ORDER BY "tradeDate" DESC
        LIMIT 1
      ) b ON true
      WHERE i."isActive" = true
        AND i."assetType" IN (
          'STOCK'::"AssetType",
          'GOLD_ETF'::"AssetType",
          'FUND'::"AssetType",
          'OPTION'::"AssetType"
        )
        AND ${listedOptionSql()}
    `;
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      assetType: row.assetType,
      lastPrice: row.lastPrice,
      closePrice: row.closePrice,
      volume: row.volume,
      buyQueueVolume: row.buyQueueVolume,
      sellQueueVolume: row.sellQueueVolume,
      raw: null,
      meta: row.meta,
    }));
  }

  async getOptionBoard() {
    const rows = await this.prisma.instrument.findMany({
      where: {
        isActive: true,
        assetType: { in: [AssetType.STOCK, AssetType.GOLD_ETF, AssetType.FUND, AssetType.OPTION] },
      },
      select: {
        id: true,
        symbol: true,
        nameFa: true,
        assetType: true,
        meta: true,
        priceBars: {
          orderBy: { tradeDate: 'desc' },
          take: 1,
          select: { lastPrice: true, closePrice: true, volume: true, raw: true },
        },
      },
    });
    return buildOptionBoard(
      rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        nameFa: row.nameFa,
        assetType: row.assetType,
        lastPrice: row.priceBars[0]?.lastPrice ?? null,
        closePrice: row.priceBars[0]?.closePrice ?? null,
        volume: row.priceBars[0]?.volume ?? null,
        raw: row.priceBars[0]?.raw ?? null,
        meta: row.meta,
      })),
    );
  }

  async getInstrument(id: string) {
    const i = await this.prisma.instrument.findUnique({
      where: { id },
      include: {
        priceBars: {
          orderBy: { tradeDate: 'desc' },
          take: 1,
          select: {
            lastPrice: true,
            closePrice: true,
            eps: true,
            pe: true,
            volume: true,
            tradeDate: true,
          },
        },
      },
    });
    if (!i || optionMetaExpired(i.meta, i.assetType, { nameFa: i.nameFa, symbol: i.symbol })) return null;
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
    const inst = await this.prisma.instrument.findUnique({
      where: { id },
      select: { assetType: true, meta: true, nameFa: true, symbol: true },
    });
    if (inst && optionMetaExpired(inst.meta, inst.assetType, { nameFa: inst.nameFa, symbol: inst.symbol })) return [];
    const bars = await this.prisma.priceBar.findMany({
      where: { instrumentId: id },
      orderBy: { tradeDate: 'desc' },
      take: Math.min(Math.max(limit, 1), 2000),
      select: {
        tradeDate: true,
        lastPrice: true,
        closePrice: true,
        eps: true,
        pe: true,
        volume: true,
      },
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
        await this.aiUsage.assertAllowed(userId, 'market_tehran_chat');
        reply = await this.answerTehranMarketChat(userId, role, text, mentioned);
      } catch (e) {
        if (e instanceof AiQuotaExceededException) {
          reply = 'سهمیه توکن شما تمام شده است. از بخش کیف پول در تنظیمات، حساب خود را شارژ کنید.';
        } else {
          reply = `متأسفانه مدل زبانی در دسترس نیست. (${(e as Error).message.slice(0, 120)})`;
        }
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
          optionBoard: optionBoardForPrompt(await this.getOptionBoard().catch(() => emptyOptionBoard())),
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
            assetType: { in: [AssetType.STOCK, AssetType.INDEX, AssetType.FUND, AssetType.GOLD_ETF, AssetType.OPTION] },
            ...(await visibleInstrumentsWhere(this.prisma)),
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

  getBrsApiConfig() {
    return readBrsApiPublic(this.prisma);
  }

  saveBrsApiConfig(data: { baseUrl?: string; apiToken?: string }) {
    return persistBrsApiConfig(this.prisma, data);
  }

  async testBrsApi() {
    const access = await readBrsApiAccess(this.prisma);
    if (!access) {
      throw new BadRequestException('ابتدا نشانی و توکن API بورس ایران را ذخیره کنید.');
    }
    const data = await this.fetchJson(
      brsEndpoint(access.baseUrl, '/Tsetmc/AllSymbols.php', access.apiKey, { type: '1' }),
    );
    const count = Array.isArray(data) ? data.length : 0;
    if (!count) {
      throw new BadRequestException('اتصال برقرار شد ولی فهرست نمادها خالی بود.');
    }
    return {
      ok: true,
      messageFa: `اتصال برقرار است. ${count.toLocaleString('fa-IR')} نماد از مسیر همه نمادها خوانده شد.`,
    };
  }

  async ingestToday() {
    return this.ingestCatchUp();
  }

  optionsRefreshStatus() {
    return this.optionsRefresh;
  }

  /**
   * دکمهٔ ادمین همین‌جا جواب می‌گیرد.
   * ذخیرهٔ قراردادها در پس‌زمینه تمام می‌شود تا پروکسی اتصال را با خطای ۵۰۲ نبندد.
   */
  refreshOptionsNow() {
    if (this.ingestInFlight) {
      return {
        started: false,
        messageFa: 'به‌روزرسانی بازار از قبل در حال انجام است. لطفاً صبر کنید.',
      };
    }
    this.ingestInFlight = true;
    this.optionsRefresh = {
      running: true,
      error: false,
      messageFa: 'به‌روزرسانی اختیار شروع شد.',
    };
    void this.finishOptionsRefresh();
    return {
      started: true,
      messageFa: 'به‌روزرسانی اختیار شروع شد. جدول پس از پایان کار تازه می‌شود.',
    };
  }

  private async finishOptionsRefresh() {
    try {
      const saved = await this.ingestOptions(dEvenToDate(snapshotTradingDEven()));
      this.optionsRefresh = {
        running: false,
        error: false,
        messageFa: `اختیار معامله به‌روز شد: ${saved.toLocaleString('fa-IR')} قرارداد.`,
      };
    } catch (e) {
      await this.recordMarketError(e);
      const message = e instanceof Error ? e.message : 'به‌روزرسانی اختیار معامله ناموفق بود.';
      this.optionsRefresh = { running: false, error: true, messageFa: message };
    } finally {
      this.ingestInFlight = false;
    }
  }

  /** اینجست بازار همین حالا در حال اجراست؛ غربال روزانه تا پایانش صبر می‌کند. */
  get ingestRunning(): boolean {
    return this.ingestInFlight;
  }

  ingestCatchUp() {
    return this.beginIngest(true);
  }

  /**
   * پاسخ دکمه زود برمی‌گردد تا پروکسی اتصال را نبندد.
   * خودِ کار در پس‌زمینه تمام می‌شود و خطایش در خطاهای مشاهده‌شده می‌ماند.
   */
  private beginIngest(manual: boolean) {
    if (this.ingestInFlight) {
      if (manual) {
        throw new ServiceUnavailableException('به‌روزرسانی بازار از قبل در حال انجام است. لطفاً صبر کنید.');
      }
      return { started: false, messageFa: 'به‌روزرسانی بازار از قبل در حال انجام است.' };
    }
    this.ingestInFlight = true;
    void this.finishIngest();
    return {
      started: true,
      messageFa: 'به‌روزرسانی بازار شروع شد. اگر خطا بدهد، در خطاهای مشاهده‌شده و سلامت داده می‌ماند.',
    };
  }

  private async finishIngest() {
    try {
      const result = await this.runIngestCatchUp();
      await this.prisma.marketIngestStatus.upsert({
        where: { id: 'latest' },
        create: { id: 'latest', ok: true, message: '', finishedAt: new Date() },
        update: { ok: true, message: '', finishedAt: new Date() },
      });
      this.logger.log(`اینجست بازار تمام شد: ${result.upserted} ردیف`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`اینجست بازار ناموفق: ${message}`);
      await this.recordMarketError(e);
      await this.prisma.marketIngestStatus
        .upsert({
          where: { id: 'latest' },
          create: { id: 'latest', ok: false, message: message.slice(0, 500), finishedAt: new Date() },
          update: { ok: false, message: message.slice(0, 500), finishedAt: new Date() },
        })
        .catch((logErr) => {
          this.logger.warn(`ثبت وضعیت خطای بازار ناموفق: ${(logErr as Error).message}`);
        });
    } finally {
      this.ingestInFlight = false;
    }
  }

  private async recordMarketError(err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 4000);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
    const statusCode =
      err && typeof err === 'object' && 'getStatus' in err && typeof err.getStatus === 'function'
        ? (err as { getStatus: () => number }).getStatus()
        : null;
    try {
      await this.prisma.llmErrorLog.create({
        data: {
          purpose: 'market_ingest',
          statusCode,
          message,
          detail: `به‌روزرسانی بازار سهام\n${message}${stack}`.slice(0, 20000),
        },
      });
    } catch (logErr) {
      this.logger.warn(`ثبت خطای بازار در خطاهای مشاهده‌شده ناموفق: ${(logErr as Error).message}`);
    }
  }

  private async runIngestCatchUp() {
    // آخرین روز فهرست همان روزی است که ارقام لحظه‌ای منبع به آن تعلق دارد، نه لزوماً تاریخ تقویمی امروز
    const todayDEven = snapshotTradingDEven();
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
        'هیچ داده‌ای از بازار دریافت نشد. در تنظیمات ادمین، بخش API بورس ایران، نشانی و توکن را ذخیره کنید.',
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
    this.logger.log(`اینجست روز ${dEven} (تهران)`);

    // runExtras یعنی آخرین روز معاملاتی؛ فقط همان از ارقام لحظه‌ای منبع خوانده می‌شود
    const { rows, source } = await this.fetchRowsForDate(dEven, runExtras);
    this.logger.log(`منبع ${dEven}: ${source} — ${rows.length} ردیف خام`);

    if (!rows.length) {
      const optionCount = runExtras ? await this.saveOptions(tradeDate) : 0;
      return { tradeDate: dEven, upserted: optionCount, source };
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

      let instrument;
      try {
        instrument = await this.saveInstrument({ symbol, nameFa, assetType, insCode });
      } catch (e) {
        this.logger.warn(`ردیف نماد ${symbol}: ${(e as Error).message}`);
        continue;
      }

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
      upserted += await this.saveOptions(tradeDate);
      if (source.startsWith('cdn.') || source.startsWith('webgw.') || source.startsWith('brsapi.')) {
        await this.enrichEpsPe(80, tradeDate);
      }
    }

    return { tradeDate: dEven, upserted, source };
  }

  async getMarketIndices(historyDays = 60) {
    const take = Math.min(Math.max(historyDays, 5), 365);
    return this.readMarketIndices(take);
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
        select: { tradeDate: true, closePrice: true, lastPrice: true },
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
      upserted += await this.syncUsdIndexBars();
    } catch (e) {
      this.logger.warn(`شاخص دلاری: ${(e as Error).message}`);
    }

    this.logger.log(`شاخص‌ها: ${upserted} ردیف ذخیره شد`);
    return { upserted };
  }

  private indexSnapshotAt = 0;

  /** فقط از زمان‌بندی و به‌روزرسانی ادمین صدا زده می‌شود، نه از باز شدن صفحه. */
  private async ensureLatestIndexValues(force = false) {
    if (!force && Date.now() - this.indexSnapshotAt < 15 * 60 * 1000) return 0;
    if (this.indexSnapshotInFlight) return this.indexSnapshotInFlight;
    this.indexSnapshotInFlight = this.persistLiveIndexSnapshot()
      .then(async (count) => {
        this.indexSnapshotAt = count > 0 ? Date.now() : Date.now() - 12 * 60 * 1000;
        if (force && count === 0) {
          await this.recordMarketError(new Error('عدد شاخص کل و هم‌وزن از API بورس ایران خوانده نشد.'));
        }
        return count;
      })
      .finally(() => {
        this.indexSnapshotInFlight = null;
      });
    return this.indexSnapshotInFlight;
  }

  private async persistLiveIndexSnapshot(): Promise<number> {
    const snaps: Partial<Record<MarketIndexKey, IndexLiveSnap>> = {
      ...(await this.fetchBrsApiIndexSnapshot()),
    };
    if (!snaps.total && !snaps.equalWeight && !(await readBrsApiAccess(this.prisma))) {
      const tse = await this.fetchTsetmcLiveIndexSnapshot();
      if (tse.total) snaps.total = tse.total;
      if (tse.equalWeight) snaps.equalWeight = tse.equalWeight;
    }
    if (snaps.total || snaps.equalWeight) {
      this.logger.log(
        `شاخص لحظه‌ای: کل ${snaps.total?.lastValue ?? '—'} ، هم‌وزن ${snaps.equalWeight?.lastValue ?? '—'}`,
      );
    }
      const tradeDate = dEvenToDate(snapshotTradingDEven());
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
      upserted += await this.syncUsdIndexBars();
    } catch (e) {
      this.logger.warn(`شاخص دلاری لحظه‌ای: ${(e as Error).message}`);
    }
    return upserted;
  }

  /** بعد از ذخیرهٔ دلار: شاخص هر روز ÷ دلار همان روز، و نوشتن در جدول قیمت. */
  async storeUsdIndicesFromDollar(): Promise<number> {
    return this.syncUsdIndexBars();
  }

  /** فقط روزهایی که هم شاخص و هم دلار همان تاریخ را دارند. نرخ روز دیگر جایگزین نمی‌شود. */
  private async syncUsdIndexBars(): Promise<number> {
    const spots = await this.prisma.spotPriceDaily.findMany({
      where: { usdIrr: { gt: 0 } },
      select: { dateKey: true, usdIrr: true },
    });
    const rateByDay = new Map<string, number>();
    for (const row of spots) {
      if (row.usdIrr != null && row.usdIrr > 0) rateByDay.set(row.dateKey, row.usdIrr);
    }
    if (!rateByDay.size) return 0;

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
        orderBy: { tradeDate: 'asc' },
      });
      if (!bars.length) continue;

      const usdInst = await this.prisma.instrument.upsert({
        where: { insCode: def.insCode },
        create: {
          insCode: def.insCode,
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          meta: { unit: 'usd', baseSymbol: base.symbol, derived: true },
        },
        update: {
          symbol: def.symbol,
          nameFa: def.nameFa,
          assetType: AssetType.INDEX,
          isActive: true,
          meta: { unit: 'usd', baseSymbol: base.symbol, derived: true },
        },
      });

      const written: Date[] = [];
      for (const bar of bars) {
        const points = bar.closePrice ?? bar.lastPrice;
        if (points == null || !(points > 0)) continue;
        const usdIrr = rateByDay.get(tradeDateKey(bar.tradeDate));
        const usdValue = usdIrr == null ? null : indexPointsToUsd(points, usdIrr);
        if (usdValue == null) continue;
        written.push(bar.tradeDate);
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
      await this.prisma.priceBar.deleteMany({
        where: {
          instrumentId: usdInst.id,
          ...(written.length ? { tradeDate: { notIn: written } } : {}),
        },
      });
    }
    return upserted;
  }

  private async fetchBrsApiIndexSnapshot(): Promise<Partial<Record<MarketIndexKey, IndexLiveSnap>>> {
    const access = await readBrsApiAccess(this.prisma);
    if (!access) return {};
    const out: Partial<Record<MarketIndexKey, IndexLiveSnap>> = {};
    try {
      const data = await this.fetchJson(
        brsEndpoint(access.baseUrl, '/Tsetmc/Index.php', access.apiKey, { type: '1' }),
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
        brsEndpoint(access.baseUrl, '/Tsetmc/Index.php', access.apiKey, { type: '3' }),
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
   * نشانی و توکن از تنظیمات ادمین، بخش API بورس ایران.
   */
  private async fetchBrsApiAllSymbols(): Promise<IngestRow[]> {
    const access = await readBrsApiAccess(this.prisma);
    if (!access) {
      this.logger.warn('توکن API بورس ایران در تنظیمات ادمین ذخیره نشده است.');
      return [];
    }

    const types = (process.env.BRS_API_TYPES ?? '1').split(',').map((t) => t.trim()).filter(Boolean);
    const rows: IngestRow[] = [];
    const seen = new Set<string>();

    for (const type of types) {
      const url = brsEndpoint(access.baseUrl, '/Tsetmc/AllSymbols.php', access.apiKey, { type });
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

  private async enrichEpsPe(limit: number, tradeDate: Date) {
    const stocks = await this.prisma.instrument.findMany({
      where: { assetType: AssetType.STOCK, insCode: { not: null } },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    });
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

  /** خطای اختیار، اینجست سهام را قطع نمی‌کند و در خطاهای مشاهده‌شده می‌ماند */
  private async saveOptions(tradeDate: Date): Promise<number> {
    try {
      return await this.ingestOptions(tradeDate);
    } catch (e) {
      this.logger.warn(`دریافت اختیار معامله ناموفق: ${(e as Error).message}`);
      await this.recordMarketError(e);
      return 0;
    }
  }

  private async ingestOptions(tradeDate: Date): Promise<number> {
    const items = await this.fetchOptionContracts();
    if (!items.length) {
      throw new Error('فهرست اختیار معامله خالی بود. در تنظیمات، API بورس ایران را بررسی کنید.');
    }
    const bySymbol = new Map<string, Record<string, unknown>>();
    for (const item of items) bySymbol.set(this.optionSymbol(item), item);
    bySymbol.delete('');
    const list = [...bySymbol.values()];
    let saved = 0;
    const chunk = 8;
    for (let i = 0; i < list.length; i += chunk) {
      const counts = await Promise.all(
        list.slice(i, i + chunk).map((item) => this.saveOptionContract(tradeDate, item)),
      );
      saved += counts.reduce((sum, n) => sum + n, 0);
    }
    if (!saved) throw new Error('هیچ قرارداد اختیاری ذخیره نشد.');
    this.logger.log(`اختیار معامله: ${saved} قرارداد`);
    return saved;
  }

  private optionSymbol(item: Record<string, unknown>): string {
    return String(item.l18 ?? item.namad ?? item.lVal18AFC ?? item.instrumentName ?? item.symbol ?? '').trim();
  }

  private async saveOptionContract(tradeDate: Date, item: Record<string, unknown>): Promise<number> {
    const symbol = this.optionSymbol(item);
    const nameFa = String(item.l30 ?? item.name ?? item.lVal30 ?? item.companyNamePersian ?? symbol).trim();
    if (!symbol) return 0;
    try {
      const meta = parseOptionMeta(item, symbol, nameFa);
      const prices = optionTradePrice({ raw: item });
      const volume = marketNumber(item.tvol ?? item.tradeVolume ?? item.qTotTran5J ?? item.volume);
      const instrument = await this.prisma.instrument.upsert({
        where: { symbol_assetType: { symbol, assetType: AssetType.OPTION } },
        create: {
          symbol,
          nameFa: nameFa || symbol,
          assetType: AssetType.OPTION,
          meta: meta as Prisma.InputJsonValue,
        },
        update: { nameFa: nameFa || symbol, meta: meta as Prisma.InputJsonValue, isActive: true },
      });
      await this.prisma.priceBar.upsert({
        where: { instrumentId_tradeDate: { instrumentId: instrument.id, tradeDate } },
        create: {
          instrumentId: instrument.id,
          tradeDate,
          lastPrice: prices.last,
          closePrice: prices.close,
          volume,
          raw: item as Prisma.InputJsonValue,
        },
        update: {
          lastPrice: prices.last,
          closePrice: prices.close,
          volume,
          raw: item as Prisma.InputJsonValue,
        },
      });
      return 1;
    } catch (e) {
      this.logger.warn(`ردیف اختیار ${symbol}: ${(e as Error).message}`);
      return 0;
    }
  }

  private async fetchOptionContracts(): Promise<Record<string, unknown>[]> {
    const fromBrs = await this.fetchBrsOptions();
    if (fromBrs.length) return fromBrs;
    try {
      const data = await this.fetchJson(
        'https://webgw.tse.ir/InstrumentProvider/api/v1/MarketWatch/MarketWatchOption/fa',
      );
      const items: unknown[] = data?.Items ?? data?.items ?? [];
      return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
    } catch (e) {
      this.logger.warn(`دیده‌بان اختیار ناموفق: ${(e as Error).message}`);
      return [];
    }
  }

  private optionRows(data: unknown): Record<string, unknown>[] {
    const asRows = (list: unknown[]) =>
      list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    if (Array.isArray(data)) return asRows(data);
    if (!data || typeof data !== 'object') return [];
    const obj = data as Record<string, unknown>;
    for (const key of ['data', 'option', 'Option', 'options', 'result', 'items']) {
      if (Array.isArray(obj[key])) return asRows(obj[key] as unknown[]);
    }
    const values = Object.values(obj).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const contracts = values.filter(
      (item) => 'l18' in (item as Record<string, unknown>) || 'base_l18' in (item as Record<string, unknown>),
    );
    return asRows(contracts);
  }

  private async fetchBrsOptions(): Promise<Record<string, unknown>[]> {
    const access = await readBrsApiAccess(this.prisma);
    if (!access) return [];
    try {
      const data = await this.fetchJson(brsEndpoint(access.baseUrl, '/Tsetmc/Option.php', access.apiKey));
      const list = this.optionRows(data);
      if (!list.length && data && typeof data === 'object') {
        const note = String(
          (data as { message_error?: unknown; message?: unknown }).message_error ??
            (data as { message?: unknown }).message ??
            '',
        ).trim();
        if (note) this.logger.warn(`اختیار BrsApi: ${note}`);
      }
      return list;
    } catch (e) {
      this.logger.warn(`اختیار BrsApi ناموفق: ${(e as Error).message}`);
      return [];
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

  /**
   * شناسهٔ داخلی نماد گاهی از سقف عدد امن جاوااسکریپت بزرگ‌تر است.
   * اگر همان عدد بماند، چند نماد یک شناسه می‌گیرند و قید یکتای نماد می‌شکند.
   */
  private async saveInstrument(input: {
    symbol: string;
    nameFa: string;
    assetType: AssetType;
    insCode?: string;
  }) {
    const { symbol, nameFa, assetType, insCode } = input;
    const existing = await this.prisma.instrument.findUnique({
      where: { symbol_assetType: { symbol, assetType } },
    });
    let insCodeToSet: string | undefined;
    if (insCode) {
      const owner = await this.prisma.instrument.findUnique({ where: { insCode } });
      if (!owner || (existing != null && owner.id === existing.id)) insCodeToSet = insCode;
    }
    if (existing) {
      return this.prisma.instrument.update({
        where: { id: existing.id },
        data: {
          nameFa,
          isActive: true,
          ...(insCodeToSet ? { insCode: insCodeToSet } : {}),
        },
      });
    }
    try {
      return await this.prisma.instrument.create({
        data: {
          symbol,
          nameFa,
          assetType,
          ...(insCodeToSet ? { insCode: insCodeToSet } : {}),
        },
      });
    } catch (e) {
      if (!this.isUniqueConflict(e)) throw e;
      const again = await this.prisma.instrument.findUnique({
        where: { symbol_assetType: { symbol, assetType } },
      });
      if (!again) throw e;
      return this.prisma.instrument.update({
        where: { id: again.id },
        data: { nameFa, isActive: true },
      });
    }
  }

  private isUniqueConflict(e: unknown): boolean {
    return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002');
  }

  private async fetchJson(url: string, timeoutMs = 45_000) {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${res.status} ${redactBrsUrl(url)}`);
    const text = await res.text();
    if (/مسدود|دسترسی شما|request rejected|access denied/i.test(text)) {
      throw new Error(`blocked: ${redactBrsUrl(url)}`);
    }
    try {
      return JSON.parse(text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
    } catch {
      throw new Error(`non-json: ${redactBrsUrl(url)}`);
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

function emptyOptionBoard(): OptionBoard {
  return {
    disclaimerFa: '',
    buyQueues: [],
    sellQueues: [],
    worthwhileOptions: [],
    replacements: [],
  };
}
