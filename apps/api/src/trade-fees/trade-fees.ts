export type TradeFeeRates = {
  stockBuyPct: number;
  stockSellPct: number;
  physicalUsdBuyPct: number;
  physicalUsdSellPct: number;
  physicalGoldBuyPct: number;
  physicalGoldSellPct: number;
};

export const ZERO_TRADE_FEES: TradeFeeRates = {
  stockBuyPct: 0,
  stockSellPct: 0,
  physicalUsdBuyPct: 0,
  physicalUsdSellPct: 0,
  physicalGoldBuyPct: 0,
  physicalGoldSellPct: 0,
};

export function clampFeePct(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(30, value);
}

export function feeSides(
  fees: TradeFeeRates,
  assetType: string | null | undefined,
): { buyPct: number; sellPct: number } {
  if (assetType === 'PHYSICAL_USD') {
    return { buyPct: fees.physicalUsdBuyPct, sellPct: fees.physicalUsdSellPct };
  }
  if (assetType === 'PHYSICAL_GOLD') {
    return { buyPct: fees.physicalGoldBuyPct, sellPct: fees.physicalGoldSellPct };
  }
  if (assetType === 'CASH' || assetType === 'DEPOSIT') {
    return { buyPct: 0, sellPct: 0 };
  }
  return { buyPct: fees.stockBuyPct, sellPct: fees.stockSellPct };
}

export function roundTripPct(fees: TradeFeeRates, assetType: string | null | undefined): number {
  const sides = feeSides(fees, assetType);
  return sides.buyPct + sides.sellPct;
}

/** کارمزد خرید روی بهای تمام‌شده و کارمزد فروش روی ارزش روز، به ریال */
export function holdingFeeRial(
  fees: TradeFeeRates,
  assetType: string | null | undefined,
  costBasisRial: number,
  marketValueRial: number,
): number {
  const sides = feeSides(fees, assetType);
  const buy = (Math.max(0, costBasisRial) * sides.buyPct) / 100;
  const sell = (Math.max(0, marketValueRial) * sides.sellPct) / 100;
  return buy + sell;
}

function assetTypeFromSymbol(symbol: string | null | undefined): string {
  const key = (symbol ?? '').trim().toUpperCase();
  if (key === 'PHYSICAL_USD') return 'PHYSICAL_USD';
  if (key === 'PHYSICAL_GOLD') return 'PHYSICAL_GOLD';
  if (key === 'CASH') return 'CASH';
  return 'STOCK';
}

/**
 * سود پیش‌بینی‌شده باید از کارمزد رفت‌وبرگشت بیشتر باشد.
 * اگر کارمزد صفر است، پیشنهاد می‌ماند.
 * اگر سود اعلام نشده و معامله ورود است، پیشنهاد حذف می‌شود.
 */
export function clearsRoundTripFee(
  assetType: string | null | undefined,
  expectedProfitPct: number | null | undefined,
  fees: TradeFeeRates,
  requireDeclaredProfit: boolean,
): boolean {
  const hurdle = roundTripPct(fees, assetType);
  if (hurdle <= 0) return true;
  if (expectedProfitPct == null || !Number.isFinite(expectedProfitPct)) {
    return !requireDeclaredProfit;
  }
  return expectedProfitPct > hurdle;
}

type StrategyItem = {
  symbol: string;
  assetType?: string;
  weightPct?: number;
  reasonFa?: string;
  expectedProfitPct?: number | null;
};

/** آیتم‌هایی که سودشان از کارمزد بیشتر نیست حذف می‌شوند و وزنشان به نقد می‌رود. */
export function filterStrategyItems<T extends StrategyItem>(items: T[], fees: TradeFeeRates): T[] {
  const kept: T[] = [];
  let droppedWeight = 0;
  for (const item of items) {
    const assetType = item.assetType || assetTypeFromSymbol(item.symbol);
    if (clearsRoundTripFee(assetType, item.expectedProfitPct, fees, true)) {
      kept.push(item);
      continue;
    }
    droppedWeight += Number(item.weightPct) || 0;
  }
  if (droppedWeight <= 0.05) return kept;
  const cash = kept.find((item) => (item.assetType || item.symbol) === 'CASH');
  if (cash) {
    return kept.map((item) =>
      item === cash
        ? {
            ...item,
            weightPct: (Number(item.weightPct) || 0) + droppedWeight,
            reasonFa: `${item.reasonFa ?? ''} بخشی که سودش از کارمزد بیشتر نبود در نقد ماند.`.trim(),
          }
        : item,
    );
  }
  kept.push({
    symbol: 'CASH',
    assetType: 'CASH',
    weightPct: droppedWeight,
    reasonFa: 'سود پیش‌بینی‌شده از کارمزد خرید و فروش بیشتر نبود؛ این بخش در نقد ماند.',
  } as T);
  return kept;
}

const ENTRY_ACTIONS = new Set(['ADD', 'INCREASE', 'SET']);

export function suggestionClearsFees(
  suggestion: {
    action?: string;
    assetType?: string;
    symbol?: string;
    expectedProfitPct?: number | null;
  },
  fees: TradeFeeRates,
): boolean {
  const action = (suggestion.action ?? '').toUpperCase();
  if (!action || action === 'SKIP') return true;
  const assetType = suggestion.assetType || assetTypeFromSymbol(suggestion.symbol);
  return clearsRoundTripFee(
    assetType,
    suggestion.expectedProfitPct,
    fees,
    ENTRY_ACTIONS.has(action),
  );
}

export function feeInstructionFa(fees: TradeFeeRates): string {
  return [
    'کارمزد معامله (درصد از مبلغ معامله) در tradeFees آمده است:',
    `- بازار سهام تهران، شامل سهام و صندوق و صندوق طلا و اختیار: خرید ${fees.stockBuyPct} ، فروش ${fees.stockSellPct}`,
    `- دلار فیزیکی: خرید ${fees.physicalUsdBuyPct} ، فروش ${fees.physicalUsdSellPct}`,
    `- طلای فیزیکی: خرید ${fees.physicalGoldBuyPct} ، فروش ${fees.physicalGoldSellPct}`,
    'نقد و سپرده کارمزد خرید و فروش ندارند.',
    'برای هر آیتم یا پیشنهاد معاملاتی expectedProfitPct را بده: سود پیش‌بینی‌شده به درصد، پیش از کسر کارمزد.',
    'اگر این سود از مجموع کارمزد خرید و فروش همان نوع دارایی بیشتر نیست، آن پیشنهاد را اصلاً در خروجی نیاور.',
  ].join('\n');
}
