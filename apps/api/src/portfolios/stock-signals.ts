/** روند چندروزه و رفتار صندوق‌های برتر برای هر سهم؛ فقط از دادهٔ دیتابیس، بدون مدل. */

import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { rawFigure, type StockFact } from './suggest-system-one';
import { loadTickerResolver } from '../market/ticker-resolve';
import { loadLatestFundamentalViews } from '../fundamentals/fundamental-views';

const TREND_LOOKBACK_DAYS = 45;
/** پرش روزانهٔ بیشتر از این، افزایش سرمایه یا سود نقدی است نه حرکت بازار؛ روند از بعد آن حساب می‌شود. */
const CORPORATE_ACTION_JUMP = 0.15;
/** گزارش صندوقی که بیش از این تعداد ماه از تازه‌ترین گزارش عقب‌تر است کنار می‌رود. */
const FUND_REPORT_MAX_AGE_MONTHS = 3;
const WEIGHT_STEP_PCT = 0.1;

const VALUE_KEYS = ['tval', 'qTotCap', 'tradeValue', 'TradeValue'];
const REAL_BUY_KEYS = ['Buy_I_Volume', 'buy_I_Volume', 'BuyIVolume'];
const REAL_SELL_KEYS = ['Sell_I_Volume', 'sell_I_Volume', 'SellIVolume'];
const VOLUME_KEYS = ['qTotTran5J', 'tvol', 'volume', 'tradeVolume'];

/** نماد فارسی برای تطبیق: ی و ک عربی، نیم‌فاصله و فاصله یکسان می‌شوند. */
export function symbolKey(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎\s]/g, '')
    .trim();
}

export async function attachStockSignals(prisma: PrismaService, stocks: StockFact[], tradeDate: Date) {
  if (!stocks.length) return;
  await Promise.all([
    attachTrend(prisma, stocks, tradeDate),
    attachFundMoves(prisma, stocks),
    attachFundamentals(prisma, stocks).catch(() => undefined),
  ]);
}

/**
 * آخرین صورت مالی بارگذاری‌شدهٔ هر سهم با قیمت روز همان ردیف: امتیاز بنیادی (پس از اثر قدمت گزارش)،
 * نسبت‌های اصلی و اثر تغییر اخیر دلار و کالاها. صورت مالی خیلی قدیمی فقط قدمتش را می‌فرستد.
 */
async function attachFundamentals(prisma: PrismaService, stocks: StockFact[]) {
  const prices = new Map(stocks.map((s) => [s.symbol, s.price]));
  const views = await loadLatestFundamentalViews(prisma, stocks.map((s) => s.symbol), prices);
  const bySymbol = new Map(views.map((v) => [v.symbol, v]));
  for (const stock of stocks) {
    const v = bySymbol.get(stock.symbol);
    if (!v) continue;
    stock.fage = v.score.ageMonths;
    if (v.score.stale) continue;
    stock.fq = v.score.effective;
    stock.fpe = v.ratios.pe;
    stock.fpb = v.ratios.pb;
    stock.froe = v.ratios.roe;
    stock.fgr = v.ratios.profitGrowth;
    stock.fde = v.ratios.debtToEquity;
    stock.fcr = v.ratios.currentRatio;
    stock.fmi = v.macro && v.macro.lines.length ? v.macro.score : null;
  }
}

async function attachTrend(prisma: PrismaService, stocks: StockFact[], tradeDate: Date) {
  const since = new Date(tradeDate.getTime() - TREND_LOOKBACK_DAYS * 86_400_000);
  const bars = await prisma.priceBar.findMany({
    where: {
      tradeDate: { gte: since, lte: tradeDate },
      instrument: { isActive: true, assetType: AssetType.STOCK, symbol: { in: stocks.map((s) => s.symbol) } },
    },
    orderBy: { tradeDate: 'asc' },
    select: {
      lastPrice: true,
      closePrice: true,
      volume: true,
      raw: true,
      instrument: { select: { symbol: true } },
    },
  });
  const bySymbol = new Map<string, typeof bars>();
  for (const bar of bars) {
    const list = bySymbol.get(bar.instrument.symbol) ?? [];
    list.push(bar);
    bySymbol.set(bar.instrument.symbol, list);
  }
  for (const stock of stocks) {
    const series = bySymbol.get(stock.symbol) ?? [];
    const points = series
      .map((bar) => ({
        price: bar.closePrice != null && bar.closePrice > 0 ? bar.closePrice : bar.lastPrice ?? 0,
        value: rawFigure(bar.raw, VALUE_KEYS),
        volume: bar.volume != null && bar.volume > 0 ? bar.volume : rawFigure(bar.raw, VOLUME_KEYS),
        realBuy: rawFigure(bar.raw, REAL_BUY_KEYS),
        realSell: rawFigure(bar.raw, REAL_SELL_KEYS),
      }))
      .filter((point) => point.price > 0);
    let start = 0;
    for (let i = points.length - 1; i > 0; i--) {
      if (Math.abs(points[i].price / points[i - 1].price - 1) > CORPORATE_ACTION_JUMP) {
        start = i;
        break;
      }
    }
    const clean = points.slice(start);
    const last = clean.length - 1;
    const change = (days: number) =>
      last >= days ? (clean[last].price / clean[last - days].price - 1) * 100 : null;
    stock.r5 = change(5);
    stock.r20 = change(20);

    const recent = clean.slice(-21);
    const returns = recent.slice(1).map((point, i) => (point.price / recent[i].price - 1) * 100);
    if (returns.length >= 5) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      stock.v20 = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1));
    }

    const values = points.slice(-20).map((point) => point.value).filter((v): v is number => v != null && v > 0);
    if (values.length) stock.av20 = values.reduce((sum, v) => sum + v, 0) / values.length;

    const flowDays = points.slice(-5).filter((point) => point.realBuy != null && point.realSell != null && point.volume);
    const flowVolume = flowDays.reduce((sum, point) => sum + (point.volume ?? 0), 0);
    if (flowDays.length && flowVolume > 0) {
      const net = flowDays.reduce((sum, point) => sum + (point.realBuy ?? 0) - (point.realSell ?? 0), 0);
      stock.rf5 = (net / flowVolume) * 100;
    }
  }
}

export type FundTally = { holders: number; buyers: number; sellers: number; weightSum: number };

/**
 * رفتار صندوق‌های پیگیری‌شده با هر سهم در آخرین گزارش ماهانه نسبت به گزارش ماه قبل‌ترش.
 * کلید، نماد بورسی یکسان‌شده است: نماد یا نام کاملی که مدل از گزارش خوانده با جدول نمادها تطبیق داده می‌شود.
 * هر صندوق یک‌بار شمرده می‌شود حتی اگر چند کاربر آن را تعریف کرده باشند.
 */
export async function fundMoveTally(prisma: PrismaService): Promise<Map<string, FundTally>> {
  const tally = new Map<string, FundTally>();
  const reports = await prisma.fundReport.findMany({
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
      createdAt: true,
      fundDefinition: { select: { nameFa: true } },
    },
  });
  if (!reports.length) return tally;
  const monthIndex = (r: { reportYear: number | null; reportMonthNum: number | null }) =>
    (r.reportYear ?? 0) * 12 + (r.reportMonthNum ?? 0);
  const newest = Math.max(...reports.map(monthIndex));
  // یک صندوق با یک نام، حتی اگر چند کاربر جدا تعریفش کرده باشند
  const byFund = new Map<string, typeof reports>();
  for (const report of reports) {
    const key = symbolKey(report.fundDefinition?.nameFa ?? report.fundDefinitionId!);
    const list = byFund.get(key) ?? [];
    list.push(report);
    byFund.set(key, list);
  }
  const pairs: Array<{ latestId: string; previousId: string | null }> = [];
  for (const list of byFund.values()) {
    // آخرین ماه؛ اگر یک ماه چند گزارش دارد تازه‌ترین ثبت
    list.sort((a, b) => monthIndex(b) - monthIndex(a) || b.createdAt.getTime() - a.createdAt.getTime());
    const latest = list[0];
    if (newest - monthIndex(latest) > FUND_REPORT_MAX_AGE_MONTHS) continue;
    // گزارش قبلی باید از ماهی قبل‌تر باشد، نه نسخهٔ دیگری از همان ماه
    const previous = list.find((r) => monthIndex(r) < monthIndex(latest)) ?? null;
    pairs.push({ latestId: latest.id, previousId: previous?.id ?? null });
  }
  if (!pairs.length) return tally;
  const reportIds = pairs.flatMap((pair) => (pair.previousId ? [pair.latestId, pair.previousId] : [pair.latestId]));
  const [holdings, resolve] = await Promise.all([
    prisma.fundHolding.findMany({
      where: { fundReportId: { in: reportIds }, assetKind: 'STOCK' },
      select: { fundReportId: true, symbol: true, nameFa: true, action: true, weightPct: true },
    }),
    loadTickerResolver(prisma),
  ]);
  const byReport = new Map<string, Map<string, { action: string; weight: number }>>();
  for (const row of holdings) {
    const key = symbolKey(resolve(row.symbol, row.nameFa) ?? row.symbol);
    const map = byReport.get(row.fundReportId) ?? new Map<string, { action: string; weight: number }>();
    const prev = map.get(key);
    // یک سهم با دو ردیف در یک گزارش (مثلاً موجودی و خرید): وزن بیشتر و اقدام غیر موجودی می‌ماند
    map.set(key, {
      action: prev && prev.action !== 'HELD' ? prev.action : row.action,
      weight: Math.max(prev?.weight ?? 0, row.weightPct ?? 0),
    });
    byReport.set(row.fundReportId, map);
  }

  const bump = (key: string, patch: Partial<FundTally>) => {
    const row = tally.get(key) ?? { holders: 0, buyers: 0, sellers: 0, weightSum: 0 };
    row.holders += patch.holders ?? 0;
    row.buyers += patch.buyers ?? 0;
    row.sellers += patch.sellers ?? 0;
    row.weightSum += patch.weightSum ?? 0;
    tally.set(key, row);
  };
  for (const pair of pairs) {
    const latest = byReport.get(pair.latestId) ?? new Map();
    const previous = pair.previousId ? byReport.get(pair.previousId) ?? null : null;
    const keys = new Set<string>([...latest.keys(), ...(previous?.keys() ?? [])]);
    for (const key of keys) {
      const now = latest.get(key);
      const before = previous?.get(key);
      const holds = Boolean(now && now.action !== 'SOLD' && now.weight >= 0);
      const bought =
        now?.action === 'BOUGHT' ||
        Boolean(holds && previous && (!before || now!.weight > before.weight + WEIGHT_STEP_PCT));
      const sold =
        now?.action === 'SOLD' ||
        Boolean(before && (!now || now.weight < before.weight - WEIGHT_STEP_PCT));
      bump(key, {
        holders: holds ? 1 : 0,
        buyers: bought ? 1 : 0,
        sellers: sold && !bought ? 1 : 0,
        weightSum: holds ? now!.weight : 0,
      });
    }
  }
  return tally;
}

async function attachFundMoves(prisma: PrismaService, stocks: StockFact[]) {
  const tally = await fundMoveTally(prisma);
  for (const stock of stocks) {
    const row = tally.get(symbolKey(stock.symbol)) ?? tally.get(symbolKey(stock.nameFa));
    stock.fh = row?.holders ?? 0;
    stock.fb = row?.buyers ?? 0;
    stock.fs = row?.sellers ?? 0;
    stock.fw = row && row.holders > 0 ? row.weightSum / row.holders : null;
  }
}
