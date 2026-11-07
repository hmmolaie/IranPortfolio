/** روند چندروزه و رفتار صندوق‌های برتر برای هر سهم؛ فقط از دادهٔ دیتابیس، بدون مدل. */

import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { rawFigure, type StockFact } from './suggest-system-one';

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
  await Promise.all([attachTrend(prisma, stocks, tradeDate), attachFundMoves(prisma, stocks)]);
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

async function attachFundMoves(prisma: PrismaService, stocks: StockFact[]) {
  const reports = await prisma.fundReport.findMany({
    where: {
      fundDefinitionId: { not: null },
      fundDefinition: { isActive: true },
      reportYear: { not: null },
      reportMonthNum: { not: null },
    },
    select: { id: true, fundDefinitionId: true, reportYear: true, reportMonthNum: true },
  });
  if (!reports.length) return;
  const monthIndex = (r: { reportYear: number | null; reportMonthNum: number | null }) =>
    (r.reportYear ?? 0) * 12 + (r.reportMonthNum ?? 0);
  const newest = Math.max(...reports.map(monthIndex));
  const byFund = new Map<string, typeof reports>();
  for (const report of reports) {
    const list = byFund.get(report.fundDefinitionId!) ?? [];
    list.push(report);
    byFund.set(report.fundDefinitionId!, list);
  }
  const pairs: Array<{ latestId: string; previousId: string | null }> = [];
  for (const list of byFund.values()) {
    list.sort((a, b) => monthIndex(b) - monthIndex(a));
    if (newest - monthIndex(list[0]) > FUND_REPORT_MAX_AGE_MONTHS) continue;
    pairs.push({ latestId: list[0].id, previousId: list[1]?.id ?? null });
  }
  if (!pairs.length) return;
  const reportIds = pairs.flatMap((pair) => (pair.previousId ? [pair.latestId, pair.previousId] : [pair.latestId]));
  const holdings = await prisma.fundHolding.findMany({
    where: { fundReportId: { in: reportIds }, assetKind: 'STOCK' },
    select: { fundReportId: true, symbol: true, action: true, weightPct: true },
  });
  const byReport = new Map<string, Map<string, { action: string; weight: number }>>();
  for (const row of holdings) {
    const map = byReport.get(row.fundReportId) ?? new Map<string, { action: string; weight: number }>();
    map.set(symbolKey(row.symbol), { action: row.action, weight: row.weightPct ?? 0 });
    byReport.set(row.fundReportId, map);
  }

  type Tally = { holders: number; buyers: number; sellers: number; weightSum: number };
  const tally = new Map<string, Tally>();
  const bump = (key: string, patch: Partial<Tally>) => {
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
  for (const stock of stocks) {
    const row = tally.get(symbolKey(stock.symbol)) ?? tally.get(symbolKey(stock.nameFa));
    stock.fh = row?.holders ?? 0;
    stock.fb = row?.buyers ?? 0;
    stock.fs = row?.sellers ?? 0;
    stock.fw = row && row.holders > 0 ? row.weightSum / row.holders : null;
  }
}
