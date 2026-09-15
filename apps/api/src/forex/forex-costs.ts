import { FOREX_CURRENCIES } from './forex-universe';

export const NOTIONAL_USD = 100_000;

export type PairBucket = 'MAJOR' | 'CROSS' | 'EXOTIC' | 'CRYPTO' | 'METAL';

export type CostModelPublic = {
  notionalUsd: number;
  commissionPctPerSide: number;
  syncLagPct: number;
  syncLagPctPerExtraHop: number;
  noteFa: string;
  bucketsFa: Array<{ bucket: PairBucket; labelFa: string; spreadPct: number; slippagePct: number; swapPct: number }>;
};

type BucketCfg = {
  labelFa: string;
  /** اسپرد پیش‌فرض اگر بید/آسک بازار نباشد — کسر اعشاری */
  spread: number;
  slippage: number;
  swap: number;
};

const MAJORS = new Set([
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'USD/CAD',
  'NZD/USD',
]);

const EXOTIC_CODES = new Set(['CNY', 'MXN', 'HKD', 'SGD', 'SEK', 'NOK']);

const BUCKETS: Record<PairBucket, BucketCfg> = {
  MAJOR: { labelFa: 'جفت اصلی', spread: 0.00015, slippage: 0.0002, swap: 0.00004 },
  CROSS: { labelFa: 'کراس', spread: 0.0004, slippage: 0.00025, swap: 0.00006 },
  EXOTIC: { labelFa: 'اگزاتیک', spread: 0.0008, slippage: 0.0004, swap: 0.00008 },
  CRYPTO: { labelFa: 'رمزارز', spread: 0.0008, slippage: 0.0005, swap: 0.00015 },
  METAL: { labelFa: 'فلز', spread: 0.0004, slippage: 0.0003, swap: 0.00005 },
};

/** کمیسیون هر طرف · تأخیر اجرای همزمان کل بسته · تأخیر اضافه به‌ازای هر یال بیش از ۲ */
export const COMMISSION_PER_SIDE = 0.0002;
export const SYNC_LAG_BASE = 0.0003;
export const SYNC_LAG_PER_EXTRA_HOP = 0.00008;

export function pairBucket(pairSymbol: string): PairBucket {
  const [base, quote] = pairSymbol.split('/');
  const baseKind = FOREX_CURRENCIES[base ?? '']?.kind;
  const quoteKind = FOREX_CURRENCIES[quote ?? '']?.kind;
  if (baseKind === 'CRYPTO' || quoteKind === 'CRYPTO') return 'CRYPTO';
  if (baseKind === 'METAL' || quoteKind === 'METAL') return 'METAL';
  if (MAJORS.has(pairSymbol)) return 'MAJOR';
  if (EXOTIC_CODES.has(base ?? '') || EXOTIC_CODES.has(quote ?? '')) return 'EXOTIC';
  return 'CROSS';
}

export function defaultSpread(pairSymbol: string): number {
  return BUCKETS[pairBucket(pairSymbol)].spread;
}

export function bookSpread(bid?: number | null, ask?: number | null, mid?: number | null): number | null {
  if (!(bid && ask && mid) || !(bid > 0) || !(ask > bid) || !(mid > 0)) return null;
  const s = (ask - bid) / mid;
  return Number.isFinite(s) && s > 0 && s < 0.2 ? s : null;
}

export type LegCost = {
  pairSymbol: string;
  side: 'long' | 'short';
  bucket: PairBucket;
  spreadPct: number;
  spreadSource: 'market' | 'default';
  commissionPct: number;
  slippagePct: number;
  swapPct: number;
  subtotalPct: number;
};

export type TradePnl = {
  grossPct: number;
  spreadPct: number;
  commissionPct: number;
  slippagePct: number;
  swapPct: number;
  syncLagPct: number;
  costPct: number;
  netPct: number;
  grossUsd: number;
  costUsd: number;
  netUsd: number;
  recommend: boolean;
  legCount: number;
  legs: LegCost[];
};

function toPct(fraction: number): number {
  return fraction * 100;
}

function usd(fraction: number): number {
  return fraction * NOTIONAL_USD;
}

export function costModelPublic(): CostModelPublic {
  return {
    notionalUsd: NOTIONAL_USD,
    commissionPctPerSide: toPct(COMMISSION_PER_SIDE),
    syncLagPct: toPct(SYNC_LAG_BASE),
    syncLagPctPerExtraHop: toPct(SYNC_LAG_PER_EXTRA_HOP),
    noteFa:
      'سود ناخالص از اختلاف مسیر میانی است. از آن اسپرد هر پا (بید/آسک بازار یا پیش‌فرض نقدشوندگی)، کمیسیون، لغزش، سواپ یک‌شب و تأخیر اجرای همزمان کم می‌شود. حجم فرضی هر فرصت ۱۰۰٬۰۰۰ دلار است. پیشنهاد معامله فقط وقتی سود خالص > ۰ باشد.',
    bucketsFa: (Object.keys(BUCKETS) as PairBucket[]).map((bucket) => ({
      bucket,
      labelFa: BUCKETS[bucket].labelFa,
      spreadPct: toPct(BUCKETS[bucket].spread),
      slippagePct: toPct(BUCKETS[bucket].slippage),
      swapPct: toPct(BUCKETS[bucket].swap),
    })),
  };
}

export function priceLeg(
  pairSymbol: string,
  side: 'long' | 'short',
  marketSpread?: number | null,
): LegCost {
  const bucket = pairBucket(pairSymbol);
  const cfg = BUCKETS[bucket];
  const market = marketSpread && marketSpread > 0 ? marketSpread : null;
  const spread = market ?? cfg.spread;
  const commission = COMMISSION_PER_SIDE;
  const slippage = cfg.slippage;
  const swap = cfg.swap;
  return {
    pairSymbol,
    side,
    bucket,
    spreadPct: toPct(spread),
    spreadSource: market ? 'market' : 'default',
    commissionPct: toPct(commission),
    slippagePct: toPct(slippage),
    swapPct: toPct(swap),
    subtotalPct: toPct(spread + commission + slippage + swap),
  };
}

export function settleTrade(
  grossFraction: number,
  legs: Array<{ pairSymbol: string; side: 'long' | 'short'; marketSpread?: number | null }>,
): TradePnl {
  const priced = legs.map((l) => priceLeg(l.pairSymbol, l.side, l.marketSpread));
  const extraHops = Math.max(0, priced.length - 2);
  const syncLag = SYNC_LAG_BASE + extraHops * SYNC_LAG_PER_EXTRA_HOP;
  const spread = priced.reduce((s, l) => s + l.spreadPct, 0);
  const commission = priced.reduce((s, l) => s + l.commissionPct, 0);
  const slippage = priced.reduce((s, l) => s + l.slippagePct, 0);
  const swap = priced.reduce((s, l) => s + l.swapPct, 0);
  const costPct = spread + commission + slippage + swap + toPct(syncLag);
  const grossPct = grossFraction * 100;
  const netPct = grossPct - costPct;
  return {
    grossPct,
    spreadPct: spread,
    commissionPct: commission,
    slippagePct: slippage,
    swapPct: swap,
    syncLagPct: toPct(syncLag),
    costPct,
    netPct,
    grossUsd: usd(grossFraction),
    costUsd: usd(costPct / 100),
    netUsd: usd(netPct / 100),
    recommend: netPct > 0,
    legCount: priced.length,
    legs: priced,
  };
}
