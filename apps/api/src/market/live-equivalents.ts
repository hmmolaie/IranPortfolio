/** صف زندهٔ سهم و اختیارهای نزدیک سررسیدی که خریدشان جای خرید یا فروش خود سهم را می‌گیرد. توصیهٔ قطعی معامله نیست. */

import { marketNumber, type OptionSide, type QueueSide, type ValuableOption } from './option-board';

/** فقط سررسیدهای تا این تعداد روز «نزدیک» حساب می‌شوند. */
export const NEAR_EXPIRY_DAYS = 45;
/** اگر قیمت تمام‌شده بیش از این درصد از قیمت سهم فاصله داشته باشد، دیگر معادل سهم نیست. */
const MAX_GAP_PCT = 10;
const CANDIDATES_PER_SIDE = 4;

export const LIVE_SESSION_START_MIN = 9 * 60;
export const LIVE_SESSION_END_MIN = 12 * 60 + 30;

export type LiveBook = {
  bidPrice: number | null;
  bidVolume: number | null;
  askPrice: number | null;
  askVolume: number | null;
};

export type LiveEquivalent = {
  id: string;
  symbol: string;
  nameFa: string;
  side: OptionSide;
  sideFa: string;
  strike: number;
  daysLeft: number;
  premium: number;
  /** live: بهترین عرضهٔ همین لحظه در tsetmc. stored: آخرین قیمت ذخیره‌شده. */
  premiumSource: 'live' | 'stored';
  askVolume: number | null;
  contractSize: number | null;
  /** اختیار خرید: اعمال + قیمت اختیار. اختیار فروش: اعمال − قیمت اختیار. */
  effectivePrice: number;
  /** اختیار خرید: چند درصد گران‌تر از خرید خود سهم. اختیار فروش: چند درصد کمتر از فروش خود سهم. */
  gapPct: number;
  costPerContract: number;
  noteFa: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function positive(value: unknown): number | null {
  const n = marketNumber(value);
  return n != null && n > 0 ? n : null;
}

/** ردیف اول عمق بازار از پاسخ BestLimits سایت tsetmc. */
export function readBestLimit(data: unknown): LiveBook | null {
  const list = record(data).bestLimits;
  if (!Array.isArray(list) || !list.length) return null;
  const rows = list.map(record);
  const top = rows.find((row) => marketNumber(row.number) === 1) ?? rows[0];
  return {
    bidPrice: positive(top.pMeDem),
    bidVolume: positive(top.qTitMeDem),
    askPrice: positive(top.pMeOf),
    askVolume: positive(top.qTitMeOf),
  };
}

/** سقف و کف مجاز روز از پاسخ GetInstrumentInfo یا GetStaticThreshold. */
export function readPriceLimits(data: unknown): { max: number; min: number } | null {
  const root = record(data);
  const info = record(root.instrumentInfo);
  const raw = info.staticThreshold ?? root.staticThreshold;
  const row = Array.isArray(raw) ? record(raw[raw.length - 1]) : record(raw);
  const max = positive(row.psGelStaMax);
  const min = positive(row.psGelStaMin);
  return max != null && min != null ? { max, min } : null;
}

/** آخرین قیمت معامله از پاسخ GetClosingPriceInfo. */
export function readLastTrade(data: unknown): number | null {
  const root = record(data);
  const info = record(root.closingPriceInfo ?? root);
  return positive(info.pDrCotVal) ?? positive(info.pClosing);
}

/**
 * صف خرید: تقاضا روی سقف مجاز و بدون عرضه. صف فروش: عرضه روی کف مجاز و بدون تقاضا.
 * null یعنی صف نیست.
 */
export function liveQueue(book: LiveBook, limits: { max: number; min: number }): QueueSide | null {
  const noAsk = book.askVolume == null;
  const noBid = book.bidVolume == null;
  if (book.bidPrice != null && book.bidVolume != null && book.bidPrice >= limits.max && noAsk) return 'buy';
  if (book.askPrice != null && book.askVolume != null && book.askPrice <= limits.min && noBid) return 'sell';
  return null;
}

/**
 * اختیارهای در سودِ نزدیک سررسید همین سهم. صف خرید فقط اختیار خرید می‌خواهد،
 * صف فروش فقط اختیار فروش، و بدون صف هر دو.
 */
export function pickEquivalentCandidates(
  options: ValuableOption[],
  spot: number,
  queue: QueueSide | null,
): ValuableOption[] {
  const near = options.filter((row) => {
    if (row.daysLeft == null || !(row.daysLeft > 0) || row.daysLeft > NEAR_EXPIRY_DAYS) return false;
    if (queue === 'buy' && row.side !== 'CALL') return false;
    if (queue === 'sell' && row.side !== 'PUT') return false;
    return row.side === 'CALL' ? row.strike < spot : row.strike > spot;
  });
  const closest = (side: OptionSide) =>
    near
      .filter((row) => row.side === side)
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot) || (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      .slice(0, CANDIDATES_PER_SIDE);
  return [...closest('CALL'), ...closest('PUT')];
}

export function buildEquivalent(
  option: ValuableOption,
  spot: number,
  premium: number,
  premiumSource: 'live' | 'stored',
  askVolume: number | null,
): LiveEquivalent | null {
  if (!(premium > 0) || !(spot > 0) || option.daysLeft == null) return null;
  const call = option.side === 'CALL';
  const effectivePrice = call ? option.strike + premium : option.strike - premium;
  if (!(effectivePrice > 0)) return null;
  const gap = call ? ((effectivePrice - spot) / spot) * 100 : ((spot - effectivePrice) / spot) * 100;
  if (gap > MAX_GAP_PCT) return null;
  const gapPct = Math.round(gap * 10) / 10;
  const size = option.contractSize != null && option.contractSize > 0 ? option.contractSize : 1;
  const amount = Math.abs(gapPct).toLocaleString('fa-IR');
  const noteFa = call
    ? gapPct >= 0
      ? `خرید این اختیار و اعمال آن در سررسید، سهم را حدود ${amount}٪ بالاتر از قیمت فعلی تمام می‌کند.`
      : `خرید این اختیار و اعمال آن در سررسید، سهم را حدود ${amount}٪ پایین‌تر از قیمت فعلی تمام می‌کند.`
    : gapPct >= 0
      ? `خرید این اختیار و اعمال آن در سررسید، فروش سهم را حدود ${amount}٪ پایین‌تر از قیمت فعلی تمام می‌کند.`
      : `خرید این اختیار و اعمال آن در سررسید، فروش سهم را حدود ${amount}٪ بالاتر از قیمت فعلی تمام می‌کند.`;
  return {
    id: option.id,
    symbol: option.symbol,
    nameFa: option.nameFa,
    side: option.side,
    sideFa: option.sideFa,
    strike: option.strike,
    daysLeft: option.daysLeft,
    premium,
    premiumSource,
    askVolume,
    contractSize: option.contractSize,
    effectivePrice,
    gapPct,
    costPerContract: Math.round(premium * size),
    noteFa,
  };
}
