/**
 * تغییر یک‌ماههٔ عامل‌های بیرونی اثرگذار بر سود شرکت‌های بورسی: دلار بازار آزاد از دیتابیس،
 * نفت برنت، مس، فولاد و طلای جهانی از یاهو فایننس. نتیجه چند ساعت در حافظه می‌ماند.
 */
import { MACRO_DRIVER_LABELS_FA, type MacroDriverKey } from '@sabadyar/shared';
import { PrismaService } from '../prisma/prisma.service';
import { fetchYahooRecentCloses } from '../world-markets/yahoo-crypto';
import { daysAgoDateKey } from '../news/tehran-date';

export type MacroDriver = {
  key: MacroDriverKey;
  labelFa: string;
  last: number;
  /** تغییر درصدی نسبت به حدود ۳۰ روز قبل */
  changePct: number;
  asOf: string;
  unitFa: string;
};

const YAHOO_DRIVERS: Array<{ key: MacroDriverKey; symbol: string; unitFa: string }> = [
  { key: 'oil', symbol: 'BZ=F', unitFa: 'دلار هر بشکه برنت' },
  { key: 'copper', symbol: 'HG=F', unitFa: 'دلار هر پوند' },
  { key: 'steel', symbol: 'HRC=F', unitFa: 'دلار هر تن ورق گرم' },
  { key: 'gold', symbol: 'GC=F', unitFa: 'دلار هر اونس' },
];

const DEFAULT_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const CACHE_MS = 6 * 3_600_000;
const FAIL_CACHE_MS = 30 * 60_000;
const LOOKBACK_DAYS = 30;

let cache: { at: number; ttl: number; drivers: MacroDriver[] } | null = null;
let inflight: Promise<MacroDriver[]> | null = null;

function changeFromSeries(series: Array<{ tradeDate: string; close: number }>): { last: number; changePct: number; asOf: string } | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const since = new Date(Date.parse(last.tradeDate) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const base = [...series].reverse().find((p) => p.tradeDate <= since) ?? series[0];
  if (!base.close) return null;
  return { last: last.close, changePct: (last.close / base.close - 1) * 100, asOf: last.tradeDate };
}

async function usdDriver(prisma: PrismaService): Promise<MacroDriver | null> {
  const rows = await prisma.spotPriceDaily.findMany({
    where: { usdIrr: { gt: 0 }, dateKey: { gte: daysAgoDateKey(LOOKBACK_DAYS + 20) } },
    orderBy: { dateKey: 'asc' },
    select: { dateKey: true, usdIrr: true },
  });
  const series = rows.map((r) => ({ tradeDate: r.dateKey, close: r.usdIrr ?? 0 })).filter((r) => r.close > 0);
  const c = changeFromSeries(series);
  if (!c) return null;
  return { key: 'usd', labelFa: MACRO_DRIVER_LABELS_FA.usd, unitFa: 'ریال', ...c };
}

async function load(prisma: PrismaService): Promise<MacroDriver[]> {
  const out: MacroDriver[] = [];
  const usd = await usdDriver(prisma).catch(() => null);
  if (usd) out.push(usd);
  const cfg = await prisma.worldSourceApiConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
  const quoteUrl = cfg?.yahooQuoteUrl || DEFAULT_QUOTE_URL;
  await Promise.all(
    YAHOO_DRIVERS.map(async (d) => {
      try {
        const c = changeFromSeries(await fetchYahooRecentCloses(d.symbol, quoteUrl));
        if (c) out.push({ key: d.key, labelFa: MACRO_DRIVER_LABELS_FA[d.key], unitFa: d.unitFa, ...c });
      } catch {
        /* این عامل در دسترس نیست */
      }
    }),
  );
  const order: MacroDriverKey[] = ['usd', 'oil', 'copper', 'steel', 'gold', 'rate'];
  return out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export async function loadMacroDrivers(prisma: PrismaService): Promise<MacroDriver[]> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.drivers;
  if (!inflight) {
    inflight = load(prisma)
      .then((drivers) => {
        // اگر یاهو جواب نداد، زودتر دوباره امتحان می‌شود
        const ttl = drivers.length > 1 ? CACHE_MS : FAIL_CACHE_MS;
        cache = { at: Date.now(), ttl, drivers };
        return drivers;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
