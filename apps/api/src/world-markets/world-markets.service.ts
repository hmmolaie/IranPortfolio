import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateFa, tehranDateKey } from '../news/tehran-date';
import { PricesService } from '../prices/prices.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';

import { BITPIN_MARKETS_URL } from '../prices/bitpin-spot';
const REFRESH_ID = 'latest';
const CREATE_CHUNK = 250;

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

type XSignalLlmItem = {
  side?: string;
  marketCode?: string;
  titleFa?: string;
  reasonFa?: string;
  strength?: number;
  xSourceHintFa?: string;
  languagesFa?: string;
};

type XSignalLlmOut = {
  analysisSummaryFa?: string;
  sourceNoteFa?: string;
  items?: XSignalLlmItem[];
};

type MarketRef = {
  code: string;
  baseCode: string;
  baseTitleFa: string;
  quoteCode: string;
  price: string;
  changePct: number | null;
  volumeNum: number | null;
};

@Injectable()
export class WorldMarketsService implements OnModuleInit {
  private readonly logger = new Logger(WorldMarketsService.name);
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

  async list() {
    const [refresh, markets, signals] = await Promise.all([
      this.prisma.worldMarketRefresh.findUnique({ where: { id: REFRESH_ID } }),
      this.prisma.worldMarket.findMany({
        orderBy: [{ volumeNum: 'desc' }, { titleFa: 'asc' }],
      }),
      this.prisma.worldMarketSignal.findMany({
        orderBy: [{ sortOrder: 'asc' }, { strength: 'desc' }],
        take: 5,
      }),
    ]);

    const quoteCounts: Record<string, number> = {};
    for (const m of markets) {
      quoteCounts[m.quoteCode] = (quoteCounts[m.quoteCode] ?? 0) + 1;
    }

    return {
      fetchedAt: refresh?.fetchedAt ?? null,
      dateKey: refresh?.dateKey ?? null,
      dateLabelFa: refresh?.fetchedAt ? tehranDateFa(refresh.fetchedAt) : null,
      symbolCount: refresh?.symbolCount ?? markets.length,
      sourceUrl: refresh?.sourceUrl ?? BITPIN_MARKETS_URL,
      xSummaryFa: refresh?.xSummaryFa ?? null,
      xSourceNoteFa: refresh?.xSourceNoteFa ?? null,
      signals,
      quotes: Object.entries(quoteCounts)
        .map(([code, count]) => ({
          code,
          count,
          titleFa: code === 'IRT' ? 'تومان' : code === 'USDT' ? 'تتر' : code,
        }))
        .sort((a, b) => b.count - a.count),
      markets,
    };
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
      const rows = [...byCode.values()];
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
              sourceUrl: BITPIN_MARKETS_URL,
            },
            update: {
              fetchedAt,
              dateKey,
              symbolCount: rows.length,
              sourceUrl: BITPIN_MARKETS_URL,
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
        await this.refreshXSignals(rows, fetchedAt);
      } catch (e) {
        this.logger.warn(`سیگنال X اقتصاد دنیا: ${(e as Error).message.slice(0, 180)}`);
      }
      return this.list();
    } finally {
      this.refreshInFlight = false;
    }
  }

  private async refreshXSignals(
    rows: Prisma.WorldMarketCreateManyInput[],
    fetchedAt: Date,
  ) {
    const ranked: MarketRef[] = rows
      .filter((r) => r.tradable !== false && r.comingSoon !== true && r.suspended !== true)
      .map((r) => ({
        code: r.code,
        baseCode: r.baseCode,
        baseTitleFa: r.baseTitleFa,
        quoteCode: r.quoteCode,
        price: r.price,
        changePct: r.changePct ?? null,
        volumeNum: r.volumeNum ?? null,
      }))
      .sort((a, b) => (b.volumeNum ?? 0) - (a.volumeNum ?? 0));
    const universe = ranked.slice(0, 120);
    if (!universe.length) return;

    const adminId = await this.users.getAdminUserId();
    if (!adminId) {
      this.logger.warn('کاربر admin نیست؛ سیگنال X اقتصاد دنیا رد شد');
      return;
    }

    const system = await this.llm.getSystemPrompt(adminId, 'world_x_signals');
    const userPrompt = JSON.stringify(
      {
        todayTehran: tehranDateKey(fetchedAt),
        todayLabelFa: tehranDateFa(fetchedAt),
        instruction:
          'همین الان اخبار کف شبکهٔ X را به همهٔ زبان‌ها مرور کن و دقیقاً ۵ تا از قوی‌ترین سیگنال‌های خرید یا فروش را روی نمادهای همین فهرست بده. هر سیگنال باید روی یک marketCode مشخص باشد و دلیل فارسی داشته باشد.',
        markets: universe.map((m) => ({
          marketCode: m.code,
          baseCode: m.baseCode,
          nameFa: m.baseTitleFa,
          quote: m.quoteCode,
          price: m.price,
          changePct: m.changePct,
          volumeNum: m.volumeNum,
        })),
      },
      null,
      2,
    );

    let out: XSignalLlmOut;
    try {
      out = await this.llm.chatJson<XSignalLlmOut>('world_x_signals', system, userPrompt, adminId);
    } catch (e) {
      this.logger.warn(`مدل سیگنال X: ${(e as Error).message.slice(0, 180)}`);
      return;
    }

    const mapped = (Array.isArray(out.items) ? out.items : [])
      .map((item) => this.mapXSignal(item, universe, fetchedAt))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const unique: typeof mapped = [];
    const seen = new Set<string>();
    for (const row of mapped.sort((a, b) => b.strength - a.strength)) {
      const key = `${row.side}:${row.marketCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(row);
      if (unique.length >= 5) break;
    }
    if (unique.length < 5) {
      for (const row of mapped) {
        if (unique.some((u) => u.marketCode === row.marketCode && u.side === row.side)) continue;
        unique.push(row);
        if (unique.length >= 5) break;
      }
    }
    if (!unique.length) {
      this.logger.warn('مدل سیگنال X آیتم قابل‌نقشه به نماد بیت‌پین برنگرداند');
      return;
    }

    await this.prisma.$transaction([
      this.prisma.worldMarketSignal.deleteMany(),
      this.prisma.worldMarketSignal.createMany({
        data: unique.slice(0, 5).map((row, i) => ({ ...row, sortOrder: i })),
      }),
      this.prisma.worldMarketRefresh.update({
        where: { id: REFRESH_ID },
        data: {
          xSummaryFa: (out.analysisSummaryFa ?? '').trim() || null,
          xSourceNoteFa: (out.sourceNoteFa ?? '').trim() || null,
        },
      }),
    ]);
    this.logger.log(`سیگنال X اقتصاد دنیا: ${Math.min(unique.length, 5)} مورد ذخیره شد`);
  }

  private mapXSignal(
    item: XSignalLlmItem,
    universe: MarketRef[],
    fetchedAt: Date,
  ): {
    side: string;
    marketCode: string;
    baseCode: string;
    baseTitleFa: string;
    titleFa: string;
    reasonFa: string;
    strength: number;
    xSourceHintFa: string | null;
    languagesFa: string | null;
    fetchedAt: Date;
    sortOrder: number;
  } | null {
    const reasonFa = (item.reasonFa ?? '').trim();
    const titleFa = (item.titleFa ?? '').trim();
    if (!reasonFa && !titleFa) return null;
    const market = this.matchMarket(item.marketCode, titleFa, universe);
    if (!market) return null;
    const rawSide = (item.side ?? '').trim().toUpperCase();
    const side =
      rawSide === 'SELL' || /فروش|short|bear/i.test(item.side ?? '')
        ? 'SELL'
        : rawSide === 'BUY' || /خرید|long|bull/i.test(item.side ?? '')
          ? 'BUY'
          : null;
    if (!side) return null;
    const strengthNum = Number(item.strength);
    const strength = Number.isFinite(strengthNum)
      ? Math.min(10, Math.max(1, Math.round(strengthNum * 10) / 10))
      : 7;
    return {
      side,
      marketCode: market.code,
      baseCode: market.baseCode,
      baseTitleFa: market.baseTitleFa,
      titleFa: titleFa || (side === 'BUY' ? `خرید ${market.baseTitleFa}` : `فروش ${market.baseTitleFa}`),
      reasonFa: reasonFa || titleFa,
      strength,
      xSourceHintFa: (item.xSourceHintFa ?? '').trim() || null,
      languagesFa: (item.languagesFa ?? '').trim() || null,
      fetchedAt,
      sortOrder: 0,
    };
  }

  private matchMarket(rawCode: string | undefined, titleFa: string, universe: MarketRef[]): MarketRef | null {
    const code = (rawCode ?? '').trim().toUpperCase().replace(/[-/]/g, '_');
    if (code) {
      const exact = universe.find((m) => m.code.toUpperCase() === code);
      if (exact) return exact;
      const base = code.split('_')[0];
      const byBase = universe.filter((m) => m.baseCode.toUpperCase() === base);
      const usdt = byBase.find((m) => m.quoteCode === 'USDT');
      if (usdt) return usdt;
      if (byBase[0]) return byBase[0];
    }
    const name = titleFa.trim();
    if (name.length >= 2) {
      const hit = universe.find(
        (m) => m.baseTitleFa.includes(name) || name.includes(m.baseTitleFa) || name.includes(m.baseCode),
      );
      if (hit) return hit;
    }
    return null;
  }

  private async fetchAllPages(): Promise<BitpinMarket[]> {
    const out: BitpinMarket[] = [];
    let url: string | null = BITPIN_MARKETS_URL;
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
