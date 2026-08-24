import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const GOLD_SYMBOLS = new Set(['عیار', 'طلا', 'گوهر', 'زر', 'ناب', 'مثقال', 'جواهر']);

function todayDateOnly(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function toDEven(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 30 15 * * 0-4') // تقریبی پایان بازار ایران (سرور ممکن است UTC باشد)
  async scheduledIngest() {
    try {
      await this.ingestToday();
    } catch (e) {
      this.logger.error('کرون اینجست بازار ناموفق', e as Error);
    }
  }

  async listLatest(params: { q?: string; assetType?: AssetType; take?: number }) {
    const take = Math.min(params.take ?? 100, 500);
    const instruments = await this.prisma.instrument.findMany({
      where: {
        isActive: true,
        ...(params.assetType ? { assetType: params.assetType } : {}),
        ...(params.q
          ? {
              OR: [
                { symbol: { contains: params.q } },
                { nameFa: { contains: params.q } },
              ],
            }
          : {}),
      },
      take,
      orderBy: { symbol: 'asc' },
      include: {
        priceBars: {
          orderBy: { tradeDate: 'desc' },
          take: 1,
        },
      },
    });

    return instruments.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      nameFa: i.nameFa,
      assetType: i.assetType,
      insCode: i.insCode,
      last: i.priceBars[0] ?? null,
    }));
  }

  async ingestToday() {
    const tradeDate = todayDateOnly();
    const dEven = toDEven();
    this.logger.log(`شروع اینجست بازار برای ${dEven}`);

    let rows = await this.fetchHistoryInDay(dEven);
    if (!rows.length) {
      rows = await this.fetchMarketWatchLegacy();
    }

    let upserted = 0;
    for (const row of rows) {
      const symbol = String(row.lVal18AFC ?? row.symbol ?? '').trim();
      const nameFa = String(row.lVal30 ?? row.name ?? symbol).trim();
      const insCode = row.insCode ? String(row.insCode) : undefined;
      if (!symbol) continue;

      const assetType = this.detectAssetType(symbol, row);
      const lastPrice = this.num(row.pDrCotVal ?? row.pl ?? row.lastPrice);
      const closePrice = this.num(row.pClosing ?? row.pc ?? row.closePrice);
      const eps = this.num(row.eps ?? row.estimatedEPS);
      const pe = this.num(row.pe ?? row.sectorPE ?? row.pE);
      const volume = this.num(row.qTotTran5J ?? row.volume);

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

    await this.ensureDepositInstrument(tradeDate);
    await this.ingestOptions(tradeDate);

    // تکمیل EPS/PE برای نمادهای مهم (نمونه‌ای محدود برای سرعت)
    await this.enrichEpsPe(80);

    return { tradeDate: dEven, upserted };
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
        const symbol = String(item.namad ?? item.lVal18AFC ?? item.symbol ?? '').trim();
        const nameFa = String(item.name ?? item.lVal30 ?? symbol).trim();
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
    if (GOLD_SYMBOLS.has(symbol) || String(row.lVal30 ?? '').includes('طلا')) {
      return AssetType.GOLD_ETF;
    }
    const flow = String(row.flowTitle ?? '');
    if (flow.includes('اختیار') || symbol.startsWith('ط') || symbol.startsWith('ض')) {
      // rough heuristic; real options come from options endpoint
    }
    return AssetType.STOCK;
  }

  private async fetchHistoryInDay(dEven: string): Promise<Record<string, unknown>[]> {
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
    } catch (e) {
      this.logger.warn(`HistoryInDay ناموفق: ${(e as Error).message}`);
    }
    return [];
  }

  private async fetchMarketWatchLegacy(): Promise<Record<string, unknown>[]> {
    try {
      const res = await fetch('https://old.tsetmc.com/tsev2/data/MarketWatchInit.aspx?h=0&r=0', {
        headers: { 'User-Agent': UA },
      });
      const text = await res.text();
      // فرمت: بخش‌ها با @ جدا می‌شوند؛ بخش دوم نمادها با ; و فیلدها با ,
      const parts = text.split('@');
      const body = parts[2] ?? parts[1] ?? '';
      const rows: Record<string, unknown>[] = [];
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
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.tsetmc.com/',
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }

  private num(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
