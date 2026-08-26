import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.tsetmc.com/',
  Origin: 'https://www.tsetmc.com',
};

const GOLD_SYMBOLS = new Set(['عیار', 'طلا', 'گوهر', 'زر', 'ناب', 'مثقال', 'جواهر']);

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

type IngestRow = Record<string, unknown>;

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
    this.logger.log(`شروع اینجست بازار برای ${dEven} (تهران)`);

    const { rows, source } = await this.fetchMarketRows(dEven);
    this.logger.log(`منبع داده: ${source} — ${rows.length} ردیف خام`);

    if (!rows.length) {
      throw new ServiceUnavailableException(
        'هیچ داده‌ای از بازار دریافت نشد. سرور شما IP خارج ایران دارد؛ در .env مقدار BRS_API_KEY را از https://brsapi.ir تنظیم کنید و کانتینر api را دوباره بالا بیاورید.',
      );
    }

    let upserted = 0;
    for (const row of rows) {
      const symbol = String(row.lVal18AFC ?? row.symbol ?? '').trim();
      const nameFa = String(row.lVal30 ?? row.name ?? symbol).trim();
      const insCodeRaw = row.insCode != null ? String(row.insCode).trim() : '';
      // InsCode عددی tsetmc؛ ISINهای webgw را در insCode نگذار
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

    await this.ensureDepositInstrument(tradeDate);
    await this.ingestOptions(tradeDate);

    // EPS/PE از CDN فقط وقتی منبع ایرانی در دسترس باشد (از VPS خارجی timeout می‌شود)
    if (source.startsWith('cdn.') || source.startsWith('webgw.')) {
      await this.enrichEpsPe(80);
    }

    return { tradeDate: dEven, upserted, source };
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
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}
