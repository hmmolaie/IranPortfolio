import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateFa, tehranDateKey } from '../news/tehran-date';
import { PricesService } from '../prices/prices.service';

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

@Injectable()
export class WorldMarketsService implements OnModuleInit {
  private readonly logger = new Logger(WorldMarketsService.name);
  private refreshInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PricesService,
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
    const [refresh, markets] = await Promise.all([
      this.prisma.worldMarketRefresh.findUnique({ where: { id: REFRESH_ID } }),
      this.prisma.worldMarket.findMany({
        orderBy: [{ volumeNum: 'desc' }, { titleFa: 'asc' }],
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
      return this.list();
    } finally {
      this.refreshInFlight = false;
    }
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
