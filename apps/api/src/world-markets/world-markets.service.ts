import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { daysAgoDateKey, tehranDateFa, tehranDateKey } from '../news/tehran-date';
import { PricesService } from '../prices/prices.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';
import { readMarketSourceApi, saveMarketSourceApi } from '../market-source/market-source-api';
import { fetchYahooCryptoPrices, yahooSymbolFor } from './yahoo-crypto';

const REFRESH_ID = 'latest';
const CREATE_CHUNK = 250;
const MAX_MACRO_NEWS = 5;
const MACRO_NEWS_LESSON_SOURCE = 'world_macro_news';

type MacroNewsLlmItem = {
  titleFa?: unknown;
  summaryFa?: unknown;
  assetImpactFa?: unknown;
  iranImpactFa?: unknown;
  assetsFa?: unknown;
  impactDirection?: unknown;
  relevanceScore?: unknown;
  sourceHintFa?: unknown;
  lessonTitleFa?: unknown;
  lessonBodyFa?: unknown;
};

type MacroNewsLlmOut = {
  analysisSummaryFa?: unknown;
  sourceNoteFa?: unknown;
  items?: unknown;
};

type BitpinTag = { name?: unknown; name_en?: unknown };
type BitpinCurrency = {
  id?: unknown;
  title?: unknown;
  title_fa?: unknown;
  code?: unknown;
  image?: unknown;
  color?: unknown;
  tags?: unknown;
};
type BitpinPriceInfo = {
  price?: unknown;
  change?: unknown;
  min?: unknown;
  max?: unknown;
};
type BitpinMarket = {
  id?: unknown;
  code?: unknown;
  title?: unknown;
  title_fa?: unknown;
  price?: unknown;
  volume_24h?: unknown;
  market_cap?: unknown;
  circulating_supply?: unknown;
  all_time_high?: unknown;
  tradable?: unknown;
  suspended?: unknown;
  otc_tradable?: unknown;
  coming_soon?: unknown;
  currency1?: BitpinCurrency;
  currency2?: BitpinCurrency;
  price_info?: BitpinPriceInfo;
  order_book_info?: BitpinPriceInfo;
  internal_price_info?: BitpinPriceInfo;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function asFinite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizeLessonTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** متن فارسی مدل؛ «null» و خط تیره را خالی حساب می‌کند */
function faText(v: unknown, maxChars: number): string {
  const t = asText(v).replace(/\s+/g, ' ').trim();
  if (!t || /^(null|none|n\/a|-|—)$/i.test(t)) return '';
  return t.slice(0, maxChars);
}

@Injectable()
export class WorldMarketsService implements OnModuleInit {
  private readonly logger = new Logger(WorldMarketsService.name);
  private yahooBackfill: Promise<void> | null = null;
  private yahooMissAt = 0;
  private refreshInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PricesService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.catchUpIfEmpty();
    }, 20_000);
  }

  @Cron('0 0 7 * * *', { timeZone: 'Asia/Tehran', name: 'world-markets-0700' })
  async scheduledRefresh() {
    this.logger.log('همگام‌سازی بازارهای جهانی راس ۷ صبح تهران');
    try {
      await this.refreshFromBitpin();
    } catch (e) {
      this.logger.error(`خطا در همگام‌سازی ۷ صبح: ${(e as Error).message}`);
    }
  }

  private async catchUpIfEmpty() {
    try {
      const count = await this.prisma.worldMarket.count();
      if (count > 0) return;
      this.logger.log('جدول اقتصاد دنیا خالی است؛ همگام‌سازی اولیه');
      await this.refreshFromBitpin();
    } catch (e) {
      this.logger.warn(`همگام‌سازی اولیه اقتصاد دنیا: ${(e as Error).message.slice(0, 180)}`);
    }
  }

  getSourceApi() {
    return readMarketSourceApi(this.prisma);
  }

  saveSourceApi(data: { bitpinMarketsUrl: string; yahooQuoteUrl: string }) {
    return saveMarketSourceApi(this.prisma, data);
  }

  async list() {
    const [refresh, stored, macroNews, sourceApi] = await Promise.all([
      this.prisma.worldMarketRefresh.findUnique({ where: { id: REFRESH_ID } }),
      this.prisma.worldMarket.findMany({
        orderBy: [{ volumeNum: 'desc' }, { titleFa: 'asc' }],
      }),
      this.prisma.worldMacroNews.findMany({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        take: MAX_MACRO_NEWS,
      }),
      readMarketSourceApi(this.prisma),
    ]);
    const markets = await this.ensureYahooDiffs(stored);

    const quoteCounts: Record<string, number> = {};
    for (const m of markets) {
      quoteCounts[m.quoteCode] = (quoteCounts[m.quoteCode] ?? 0) + 1;
    }

    return {
      fetchedAt: refresh?.fetchedAt ?? null,
      dateKey: refresh?.dateKey ?? null,
      dateLabelFa: refresh?.fetchedAt ? tehranDateFa(refresh.fetchedAt) : null,
      symbolCount: refresh?.symbolCount ?? markets.length,
      sourceUrl: sourceApi.bitpinMarketsUrl,
      yahooQuoteUrl: sourceApi.yahooQuoteUrl,
      yahooComparedCount: markets.filter((m) => m.diffPct != null && m.yahooPriceNum != null).length,
      quotes: Object.entries(quoteCounts)
        .map(([code, count]) => ({
          code,
          count,
          titleFa: code === 'IRT' ? 'تومان' : code === 'USDT' ? 'تتر' : code,
        }))
        .sort((a, b) => b.count - a.count),
      macroNews,
      macroNewsSummaryFa: refresh?.xSummaryFa ?? null,
      macroNewsSourceNoteFa: refresh?.xSourceNoteFa ?? null,
      markets,
    };
  }

  /** اخبار کلان جهان برای زمینهٔ پیشنهاد و آنالیز سبد */
  async recentMacroNews(limit = MAX_MACRO_NEWS) {
    return this.prisma.worldMacroNews.findMany({
      where: { dateKey: { gte: daysAgoDateKey(7) } },
      orderBy: [{ dateKey: 'desc' }, { sortOrder: 'asc' }],
      take: limit,
      select: {
        dateKey: true,
        titleFa: true,
        summaryFa: true,
        assetImpactFa: true,
        iranImpactFa: true,
        assetsFa: true,
        impactDirection: true,
        relevanceScore: true,
        sourceHintFa: true,
      },
    });
  }

  async refreshFromBitpin() {
    if (this.refreshInFlight) {
      throw new BadRequestException('همگام‌سازی قبلی هنوز تمام نشده است');
    }
    this.refreshInFlight = true;
    try {
      const rawMarkets = await this.fetchAllPages();
      const fetchedAt = new Date();
      const dateKey = tehranDateKey(fetchedAt);
      const byCode = new Map<string, Prisma.WorldMarketCreateManyInput>();
      for (const item of rawMarkets) {
        const row = this.mapMarket(item, fetchedAt);
        if (row) byCode.set(row.code, row);
      }
      const sourceApi = await readMarketSourceApi(this.prisma);
      const rows = await this.attachYahooDiffs([...byCode.values()], sourceApi.yahooQuoteUrl);
      if (!rows.length) {
        throw new BadRequestException('پاسخ بیت‌پین هیچ نمادی نداشت');
      }

      await this.prisma.$transaction(
        async (tx) => {
          await tx.worldMarket.deleteMany();
          for (let i = 0; i < rows.length; i += CREATE_CHUNK) {
            await tx.worldMarket.createMany({ data: rows.slice(i, i + CREATE_CHUNK) });
          }
          await tx.worldMarketRefresh.upsert({
            where: { id: REFRESH_ID },
            create: {
              id: REFRESH_ID,
              fetchedAt,
              dateKey,
              symbolCount: rows.length,
              sourceUrl: sourceApi.bitpinMarketsUrl,
            },
            update: {
              fetchedAt,
              dateKey,
              symbolCount: rows.length,
              sourceUrl: sourceApi.bitpinMarketsUrl,
            },
          });
        },
        { timeout: 120_000 },
      );

      this.logger.log(`اقتصاد دنیا: ${rows.length} نماد برای ${dateKey} ذخیره شد`);
      try {
        await this.prices.upsertFromBitpinMarkets(
          rows.map((r) => ({ code: r.code, priceNum: r.priceNum ?? null })),
        );
      } catch (e) {
        this.logger.warn(`ذخیره دلار/طلا از بیت‌پین: ${(e as Error).message.slice(0, 180)}`);
      }
      try {
        await this.refreshMacroNews(dateKey, fetchedAt);
      } catch (e) {
        this.logger.warn(`اخبار کلان جهان: ${(e as Error).message.slice(0, 180)}`);
      }
      return this.list();
    } finally {
      this.refreshInFlight = false;
    }
  }

  /** حداکثر ۵ خبر مهم اقتصاد کلان جهان و آمریکا؛ درس‌های پایدار هم در Lesson ذخیره می‌شوند */
  private async refreshMacroNews(dateKey: string, fetchedAt: Date) {
    const adminId = (await this.users.getAdminUserId()) ?? undefined;
    const system = await this.llm.getSystemPrompt(adminId, 'world_macro_news');
    const previous = await this.prisma.worldMacroNews.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { titleFa: true },
    });

    const out = await this.llm.chatJson<MacroNewsLlmOut>(
      'world_macro_news',
      system,
      JSON.stringify(
        {
          todayTehran: dateKey,
          todayLabelFa: tehranDateFa(fetchedAt),
          maxItems: MAX_MACRO_NEWS,
          recentHeadlinesToAvoidRepeat: previous.map((p) => p.titleFa),
          instruction:
            'مهم‌ترین اخبار اقتصاد کلان جهان و مهم‌تر از همه آمریکا را از رسانه‌های معتبر و پربازدید بخوان؛ فقط خبرهایی که روی قیمت نفت، طلا، دلار، فلزات یا رمزارز اثر دارد. حداکثر ۵ خبر. اگر خبری روی اقتصاد کلان یا بورس ایران هم اثر می‌گذارد در iranImpactFa بنویس. اگر درس پایداری برای سبد سهام داشت lessonTitleFa و lessonBodyFa را پر کن.',
        },
        null,
        2,
      ),
      adminId,
      {
        preferGrok: true,
        liveSearch: { x: true, web: true, fromDate: daysAgoDateKey(3), toDate: dateKey },
      },
    );

    const items = Array.isArray(out?.items) ? (out.items as MacroNewsLlmItem[]) : [];
    const rows = items
      .map((item, idx) => this.mapMacroNews(item, idx, dateKey, fetchedAt))
      .filter((r): r is Prisma.WorldMacroNewsCreateManyInput => Boolean(r))
      .slice(0, MAX_MACRO_NEWS);

    if (!rows.length) {
      this.logger.warn(`مدل برای ${dateKey} خبر کلان جهانی برنگرداند؛ اخبار قبلی نگه داشته شد`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.worldMacroNews.deleteMany();
      await tx.worldMacroNews.createMany({ data: rows });
      await tx.worldMarketRefresh.update({
        where: { id: REFRESH_ID },
        data: {
          xSummaryFa: faText(out?.analysisSummaryFa, 2000) || null,
          xSourceNoteFa: faText(out?.sourceNoteFa, 600) || null,
        },
      });
    });
    this.logger.log(`اخبار کلان جهان ${dateKey}: ${rows.length} خبر ذخیره شد`);

    await this.saveMacroNewsLessons(items, dateKey);
  }

  private mapMacroNews(
    item: MacroNewsLlmItem,
    idx: number,
    dateKey: string,
    fetchedAt: Date,
  ): Prisma.WorldMacroNewsCreateManyInput | null {
    const titleFa = faText(item.titleFa, 220);
    const summaryFa = faText(item.summaryFa, 2000);
    if (titleFa.length < 4 || summaryFa.length < 20) return null;
    const direction = faText(item.impactDirection, 20).toLowerCase();
    const score = asFinite(item.relevanceScore);
    return {
      dateKey,
      titleFa,
      summaryFa,
      assetImpactFa: faText(item.assetImpactFa, 1200) || null,
      iranImpactFa: faText(item.iranImpactFa, 1200) || null,
      assetsFa: faText(item.assetsFa, 300) || null,
      impactDirection: ['bullish', 'bearish', 'neutral', 'mixed'].includes(direction)
        ? direction
        : null,
      relevanceScore: score != null ? Math.max(0, Math.min(10, score)) : null,
      sourceHintFa: faText(item.sourceHintFa, 200) || null,
      sortOrder: idx,
      fetchedAt,
    };
  }

  /** درس‌های پایدار خبرهای جهانی زیر کاربر ادمین ذخیره می‌شوند تا در پیشنهاد سبد بیایند */
  private async saveMacroNewsLessons(items: MacroNewsLlmItem[], dateKey: string) {
    const adminId = await this.users.getAdminUserId();
    if (!adminId) return;

    const candidates = items
      .map((item) => ({
        titleFa: faText(item.lessonTitleFa, 180),
        bodyFa: faText(item.lessonBodyFa, 4000),
      }))
      .filter((l) => l.titleFa.length >= 4 && l.bodyFa.length >= 20);
    if (!candidates.length) return;

    const existing = await this.prisma.lesson.findMany({
      where: { userId: adminId },
      select: { titleFa: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });
    const seen = new Set(existing.map((l) => normalizeLessonTitle(l.titleFa)));

    let created = 0;
    for (const lesson of candidates) {
      const key = normalizeLessonTitle(lesson.titleFa);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      await this.prisma.lesson.create({
        data: {
          userId: adminId,
          titleFa: lesson.titleFa,
          bodyFa: lesson.bodyFa,
          source: `${MACRO_NEWS_LESSON_SOURCE}:${dateKey}`,
        },
      });
      created += 1;
    }
    if (created) {
      this.logger.log(`درس‌آموخته از اخبار جهانی ${dateKey}: ${created} مورد`);
    }
  }

  /** اگر اختلاف یاهو هنوز ذخیره نشده، یک‌بار قیمت جهانی را می‌خواند و روی همان ردیف‌ها می‌نویسد */
  private async ensureYahooDiffs<T extends Prisma.WorldMarketCreateManyInput & { code: string }>(
    markets: T[],
  ): Promise<T[]> {
    const comparable = markets.some((m) => yahooSymbolFor(String(m.baseCode), String(m.quoteCode)));
    const has = markets.some((m) => m.yahooPriceNum != null && m.diffPct != null);
    if (!comparable || has) return markets;
    if (Date.now() - this.yahooMissAt < 10 * 60_000) return markets;

    try {
      if (!this.yahooBackfill) {
        this.yahooBackfill = this.persistMissingYahooDiffs(markets).finally(() => {
          this.yahooBackfill = null;
        });
      }
      await this.yahooBackfill;
    } catch (e) {
      this.yahooMissAt = Date.now();
      this.logger.warn(`تکمیل اختلاف یاهو: ${(e as Error).message.slice(0, 180)}`);
      return markets;
    }
    return this.prisma.worldMarket.findMany({
      orderBy: [{ volumeNum: 'desc' }, { titleFa: 'asc' }],
    }) as Promise<T[]>;
  }

  private async persistMissingYahooDiffs(
    markets: Array<Prisma.WorldMarketCreateManyInput & { code: string }>,
  ) {
    const sourceApi = await readMarketSourceApi(this.prisma);
    const rows = await this.attachYahooDiffs(markets, sourceApi.yahooQuoteUrl);
    const priced = rows.filter((r) => r.yahooPriceNum != null && r.diffPct != null);
    if (!priced.length) {
      this.yahooMissAt = Date.now();
      return;
    }
    for (let i = 0; i < priced.length; i += 40) {
      const chunk = priced.slice(i, i + 40);
      await this.prisma.$transaction(
        chunk.map((r) =>
          this.prisma.worldMarket.update({
            where: { code: r.code },
            data: {
              yahooSymbol: r.yahooSymbol ?? null,
              yahooPriceNum: r.yahooPriceNum ?? null,
              diffAbs: r.diffAbs ?? null,
              diffPct: r.diffPct ?? null,
            },
          }),
        ),
      );
    }
  }

  private async attachYahooDiffs(rows: Prisma.WorldMarketCreateManyInput[], yahooQuoteUrl: string) {
    const symbols = [
      ...new Set(
        rows
          .map((r) => yahooSymbolFor(String(r.baseCode), String(r.quoteCode)))
          .filter((s): s is string => Boolean(s)),
      ),
    ];
    let yahooPrices = new Map<string, number>();
    try {
      yahooPrices = await fetchYahooCryptoPrices(symbols, yahooQuoteUrl);
    } catch (e) {
      this.logger.warn(`یاهو فایننس: ${(e as Error).message.slice(0, 180)}`);
    }

    const usdtIrt =
      rows.find(
        (r) =>
          String(r.quoteCode) === 'IRT' &&
          (String(r.baseCode) === 'USDT' || String(r.code) === 'USDT_IRT'),
      )?.priceNum ?? null;

    const matched = rows.filter((r) => {
      const y = yahooSymbolFor(String(r.baseCode), String(r.quoteCode));
      return Boolean(y && yahooPrices.has(y));
    }).length;
    this.logger.log(`مقایسه یاهو: ${matched} از ${rows.length} نماد قیمت جهانی داشت`);

    return rows.map((r) => {
      const yahooSymbol = yahooSymbolFor(String(r.baseCode), String(r.quoteCode));
      const rawYahoo = yahooSymbol ? yahooPrices.get(yahooSymbol) ?? null : null;
      let yahooPriceNum: number | null = rawYahoo ?? null;
      if (yahooPriceNum != null && String(r.quoteCode) === 'IRT' && usdtIrt != null && usdtIrt > 0) {
        yahooPriceNum = yahooPriceNum * usdtIrt;
      }
      const bitpin = r.priceNum ?? null;
      if (yahooPriceNum == null || yahooPriceNum <= 0 || bitpin == null || !(bitpin > 0)) {
        return {
          ...r,
          yahooSymbol,
          yahooPriceNum: null,
          diffAbs: null,
          diffPct: null,
        };
      }
      const diffAbs = bitpin - yahooPriceNum;
      const diffPct = (diffAbs / yahooPriceNum) * 100;
      return { ...r, yahooSymbol, yahooPriceNum, diffAbs, diffPct };
    });
  }

  private async fetchAllPages(): Promise<BitpinMarket[]> {
    const sourceApi = await readMarketSourceApi(this.prisma);
    const out: BitpinMarket[] = [];
    let url: string | null = sourceApi.bitpinMarketsUrl;
    let guard = 0;

    while (url && guard < 40) {
      guard += 1;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        throw new BadRequestException(
          `اتصال به بیت‌پین برقرار نشد: ${(e as Error).message || 'خطای شبکه'}`,
        );
      }

      const text = await res.text();
      if (!res.ok) {
        throw new BadRequestException(`بیت‌پین پاسخ ${res.status} داد`);
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new BadRequestException('پاسخ بیت‌پین JSON معتبر نیست');
      }

      const rec = asRecord(json);
      const pageItems = Array.isArray(json)
        ? json
        : Array.isArray(rec?.results)
          ? rec.results
          : Array.isArray(rec?.markets)
            ? rec.markets
            : null;

      if (!pageItems) {
        throw new BadRequestException('ساختار پاسخ بیت‌پین ناشناخته است');
      }

      for (const item of pageItems) {
        const row = asRecord(item);
        if (row) out.push(row as BitpinMarket);
      }

      const next = rec && typeof rec.next === 'string' && rec.next.trim() ? rec.next.trim() : null;
      url = next && next !== url ? next : null;
    }

    return out;
  }

  private mapMarket(item: BitpinMarket, fetchedAt: Date): Prisma.WorldMarketCreateManyInput | null {
    const code = asText(item.code);
    if (!code) return null;
    const c1 = item.currency1 ?? {};
    const c2 = item.currency2 ?? {};
    const info = item.price_info ?? item.internal_price_info ?? {};
    const book = item.order_book_info ?? {};
    const price = asText(info.price) || asText(book.price) || asText(item.price);
    let change = asFinite(info.change);
    if (change == null) {
      const bookChange = asFinite(book.change);
      if (bookChange != null) change = Math.abs(bookChange) <= 1 ? bookChange * 100 : bookChange;
    }
    const volume = asText(item.volume_24h);
    const tags = Array.isArray(c1.tags)
      ? c1.tags
          .map((t) => asText((t as BitpinTag)?.name))
          .filter(Boolean)
          .slice(0, 8)
          .join('، ')
      : '';

    return {
      bitpinId: asFinite(item.id) ?? 0,
      code,
      title: asText(item.title) || code,
      titleFa: asText(item.title_fa) || asText(item.title) || code,
      baseCode: asText(c1.code) || code.split('_')[0] || code,
      baseTitle: asText(c1.title) || asText(c1.code),
      baseTitleFa: asText(c1.title_fa) || asText(c1.title) || asText(c1.code),
      baseImageUrl: asText(c1.image) || null,
      baseColor: asText(c1.color) || null,
      quoteCode: asText(c2.code) || code.split('_')[1] || '',
      quoteTitle: asText(c2.title) || asText(c2.code),
      quoteTitleFa: asText(c2.title_fa) || asText(c2.title) || asText(c2.code),
      price,
      priceNum: asFinite(price),
      changePct: change,
      high24h: asText(info.max) || asText(book.max) || null,
      low24h: asText(info.min) || asText(book.min) || null,
      volume24h: volume || null,
      volumeNum: asFinite(volume),
      marketCap: asText(item.market_cap) || null,
      circulating: asText(item.circulating_supply) || null,
      allTimeHigh: asText(item.all_time_high) || null,
      tradable: asBool(item.tradable, true),
      suspended: asBool(item.suspended),
      otcTradable: asBool(item.otc_tradable),
      comingSoon: asBool(item.coming_soon),
      tagsFa: tags || null,
      fetchedAt,
    };
  }
}
