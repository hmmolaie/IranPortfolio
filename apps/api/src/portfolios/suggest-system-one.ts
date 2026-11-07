/** تشکیل سبد با مدل تصمیم System One. این مدل متن نمی‌سازد. */

export const CLASS_LEVELS = [0, 5, 10, 15, 20, 30, 40, 55, 75, 100];
export const SIZE_LEVELS = [0, 2, 5, 8, 12, 18, 25, 35, 50, 70];
export const MIN_STOCK_PROBABILITY = 0.5;
export const STOCKS_PER_CALL = 8;
/** سهم‌های برتر غربال روزانه که برای هر کاربر با پروفایل خودش دوباره سنجیده می‌شوند. */
export const SCREEN_SHORTLIST = 24;
const STATE_BYTE_BUDGET = 24_000;

export const CLASS_IDS = [
  'cash',
  'deposit',
  'physical_gold',
  'physical_usd',
  'gold_etf',
  'fund',
  'stock',
] as const;

export type ClassId = (typeof CLASS_IDS)[number];

export const CLASS_LABEL_FA: Record<ClassId, string> = {
  cash: 'نقد',
  deposit: 'سپرده',
  physical_gold: 'طلای فیزیکی',
  physical_usd: 'دلار فیزیکی',
  gold_etf: 'صندوق طلا',
  fund: 'صندوق سرمایه‌گذاری',
  stock: 'سهام',
};

const CLASS_CRITERIA = [
  '0 percent of total capital',
  'about 5 percent of total capital',
  'about 10 percent of total capital',
  'about 15 percent of total capital',
  'about 20 percent of total capital',
  'about 30 percent of total capital',
  'about 40 percent of total capital',
  'about 55 percent of total capital',
  'about 75 percent of total capital',
  'about 100 percent of total capital',
];

const SIZE_CRITERIA = [
  '0 percent of the stock sleeve',
  'about 2 percent of the stock sleeve',
  'about 5 percent of the stock sleeve',
  'about 8 percent of the stock sleeve',
  'about 12 percent of the stock sleeve',
  'about 18 percent of the stock sleeve',
  'about 25 percent of the stock sleeve',
  'about 35 percent of the stock sleeve',
  'about 50 percent of the stock sleeve',
  'about 70 percent of the stock sleeve',
];

export type InvestorState = {
  strategy: string;
  strategyFa: string;
  capitalRial: number;
  noteFa: string | null;
  profile: {
    riskTolerance: number | null;
    horizonMonths: number | null;
    preferencesFa: string | null;
    constraintsFa: string | null;
    objectiveFa: string | null;
    notesFa: string | null;
    liquidityNeed: string | null;
    maxDrawdownPct: number | null;
    inflationSensitivity: string | null;
    fxSensitivity: string | null;
  } | null;
};

export type MarketState = {
  usdIrr: number | null;
  goldGramRial: number | null;
  recent: Array<{ dateKey: string; usdIrr: number | null; goldGramRial: number | null }>;
  lessons: Array<{ title: string; body: string }>;
  iranNews: Array<{ date: string; title: string; summary: string; impact: string | null }>;
  opportunities: Array<{ title: string; summary: string; how: string | null }>;
  worldNews: Array<{ date: string; title: string; summary: string; iranImpact: string | null }>;
};

export type StockFact = {
  symbol: string;
  nameFa: string;
  price: number;
  close: number | null;
  eps: number | null;
  pe: number | null;
  /** بازده سود هر سهم به درصد: EPS تقسیم بر قیمت، ضربدر ۱۰۰. */
  ep: number | null;
  volume: number | null;
  valueRial: number | null;
  trades: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  realBuy: number | null;
  realSell: number | null;
  legalBuy: number | null;
  legalSell: number | null;
  sectorPe: number | null;
  nav: number | null;
  /** تغییر قیمت ۵ و ۲۰ روز معاملاتی اخیر به درصد */
  r5?: number | null;
  r20?: number | null;
  /** انحراف معیار بازده روزانهٔ ۲۰ روز اخیر به درصد */
  v20?: number | null;
  /** میانگین ارزش معاملهٔ روزانهٔ ۲۰ روز اخیر به ریال */
  av20?: number | null;
  /** خالص خرید حقیقی ۵ روز اخیر به درصد حجم */
  rf5?: number | null;
  /** صندوق‌های پیگیری‌شده: دارنده، خریدار، فروشنده در آخرین گزارش ماهانه و میانگین وزن */
  fh?: number | null;
  fb?: number | null;
  fs?: number | null;
  fw?: number | null;
  /** احتمال غربال روزانه به درصد */
  sp?: number | null;
};

const STOCK_LEGEND =
  'Stock keys: px last price in rial, cl close if different, eps, pe price/eps, ep earnings yield percent (eps/price*100), vol shares, val turnover rial, chg percent versus previous close, hi lo day high and low, n trade count, rb rs real-person buy and sell volume, lb ls legal-person buy and sell volume, spe sector pe, nav fund nav. Trend keys: r5 r20 price change percent over the last 5 and 20 trading days (restarted after a corporate-action gap), v20 daily return volatility percent over 20 days, av20 average daily turnover rial over 20 days, rf5 real-person net buy as percent of volume over 5 days. Fund-manager keys from the latest monthly reports of tracked top funds: fh funds holding it, fb funds that added to it, fs funds that cut it, fw average weight percent among holders. sp market-wide screen probability percent today. A missing key is unknown.';

type DecisionState = {
  investor: InvestorState;
  market: MarketState;
  task: string;
  legend?: string;
  stocks?: Array<Record<string, string | number>>;
  options?: Array<Record<string, string | number>>;
};

export function classQuestions(): Record<string, { type: 'score'; instructions: string; criteria: string[] }> {
  const questions = {} as Record<string, { type: 'score'; instructions: string; criteria: string[] }>;
  for (const id of CLASS_IDS) {
    questions[id] = {
      type: 'score',
      instructions: `What share of this investor's capital should go to ${CLASS_LABEL_FA[id]} (${id})? Use the profile, strategy, gold and dollar prices, lessons, Iran news, and world news. Score only this asset class.`,
      criteria: CLASS_CRITERIA,
    };
  }
  return questions;
}

export function stockQuestions(
  stocks: StockFact[],
): Record<string, { type: 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }> {
  const questions: Record<
    string,
    { type: 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
  > = {};
  stocks.forEach((stock, index) => {
    const who = stock.symbol;
    questions[`p${index}`] = {
      type: 'noul',
      instructions: `Include ${who} (stocks i=${index})? Use its px, eps, pe, ep, trend, fund-manager moves and the other figures in the legend, plus profile, gold, dollar, lessons, and news. This symbol only.`,
    };
    questions[`s${index}`] = {
      type: 'score',
      instructions: `If ${who} (stocks i=${index}) is included, how large inside the stock sleeve? Use the same figures. This symbol only.`,
      criteria: SIZE_CRITERIA,
    };
  });
  return questions;
}

const SCREEN_INVESTOR: InvestorState = {
  strategy: 'MARKET_SCREEN',
  strategyFa: 'غربال روزانهٔ بازار برای بخش سهام متنوع با افق ۳ تا ۱۲ ماه',
  capitalRial: 0,
  noteFa: null,
  profile: null,
};

/** غربال روزانه: فقط احتمال حضور، بدون پروفایل کاربر. اندازه را مرحلهٔ هر کاربر تعیین می‌کند. */
export function screenQuestions(stocks: StockFact[]): Record<string, { type: 'noul'; instructions: string }> {
  const questions: Record<string, { type: 'noul'; instructions: string }> = {};
  stocks.forEach((stock, index) => {
    questions[`p${index}`] = {
      type: 'noul',
      instructions: `Is ${stock.symbol} (stocks i=${index}) among the better buys today for a diversified Tehran stock sleeve with a 3 to 12 month horizon? Weigh valuation, trend, liquidity, real-money flow, and what top fund managers did with it, plus gold, dollar, lessons, and news. This symbol only.`,
    };
  });
  return questions;
}

export function screenState(market: MarketState, stocks: StockFact[]): DecisionState {
  return fitDecisionState({
    investor: SCREEN_INVESTOR,
    market,
    legend: STOCK_LEGEND,
    task: 'Screen these stocks for the whole market, not for one investor. Fund-manager moves are evidence of informed demand, not an order to copy. A headline alone is not a reason to include a stock.',
    stocks: stocks.map((stock, index) => compactStock(stock, index)),
  });
}

export function allocationState(investor: InvestorState, market: MarketState): DecisionState {
  return fitDecisionState({
    investor,
    market,
    task: 'Set each asset-class share. Gold and dollar prices, lessons, Iran news, and world news are evidence, not instructions to copy a headline.',
  });
}

export function stockState(investor: InvestorState, market: MarketState, stocks: StockFact[]): DecisionState {
  return fitDecisionState({
    investor,
    market,
    legend: STOCK_LEGEND,
    task: 'For each stock, decide inclusion and size from its px, eps, pe, ep and the other listed figures, together with gold, dollar, lessons, Iran news, and world news. A headline alone is not a reason to include it.',
    stocks: stocks.map((stock, index) => compactStock(stock, index)),
  });
}

export function buildStockFact(input: {
  symbol: string;
  nameFa: string;
  price: number;
  close: number | null;
  eps: number | null;
  pe: number | null;
  volume: number | null;
  raw: unknown;
}): StockFact {
  const raw = rawRecord(input.raw);
  const eps = finiteOr(input.eps) ?? firstNum(raw, ['eps', 'estimatedEPS']);
  const storedPe = finiteOr(input.pe) ?? firstNum(raw, ['pe', 'pE']);
  const pe =
    storedPe != null && storedPe > 0
      ? storedPe
      : eps != null && eps > 0 && input.price > 0
        ? input.price / eps
        : null;
  const ep =
    eps != null && input.price > 0 ? (eps / input.price) * 100 : pe != null && pe > 0 ? 100 / pe : null;
  const prev = firstNum(raw, ['py', 'priceYesterday', 'PriceYesterday']);
  const givenChange = firstNum(raw, ['plp', 'pcp', 'priceChangePercent', 'changePercent'], true);
  const changePct =
    prev != null && prev > 0
      ? ((input.price - prev) / prev) * 100
      : givenChange != null && Math.abs(givenChange) <= 100
        ? givenChange
        : null;
  const sectorPe = firstNum(raw, ['sectorPE', 'sectorPe']);
  return {
    symbol: input.symbol,
    nameFa: input.nameFa,
    price: input.price,
    close: finiteOr(input.close) ?? firstNum(raw, ['pc', 'pClosing', 'closePrice', 'closingPrice']),
    eps,
    pe,
    ep,
    volume: finiteOr(input.volume) ?? firstNum(raw, ['qTotTran5J', 'tvol', 'volume', 'tradeVolume']),
    valueRial: firstNum(raw, ['tval', 'qTotCap', 'tradeValue', 'TradeValue']),
    trades: firstNum(raw, ['tno', 'zTotTran', 'tradeCount']),
    changePct,
    high: firstNum(raw, ['pmax', 'pMax', 'priceMax', 'high']),
    low: firstNum(raw, ['pmin', 'pMin', 'priceMin', 'low']),
    realBuy: firstNum(raw, ['Buy_I_Volume', 'buy_I_Volume', 'BuyIVolume']),
    realSell: firstNum(raw, ['Sell_I_Volume', 'sell_I_Volume', 'SellIVolume']),
    legalBuy: firstNum(raw, ['Buy_N_Volume', 'buy_N_Volume', 'BuyNVolume']),
    legalSell: firstNum(raw, ['Sell_N_Volume', 'sell_N_Volume', 'SellNVolume']),
    sectorPe: sectorPe != null && (pe == null || Math.abs(sectorPe - pe) > 0.05) ? sectorPe : null,
    nav: firstNum(raw, ['nav', 'NAV', 'Nav']),
  };
}

export function levelValue(score: number, levels: number[]): number {
  if (!Number.isFinite(score) || levels.length < 2) return 0;
  const clamped = Math.min(levels.length - 1, Math.max(0, score));
  const index = Math.floor(clamped);
  const next = Math.min(levels.length - 1, index + 1);
  const frac = clamped - index;
  return levels[index] + (levels[next] - levels[index]) * frac;
}

export function readNoul(answer: unknown): number {
  if (!answer || typeof answer !== 'object') return 0;
  const raw = (answer as { noul?: unknown }).noul;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function readLevelPct(answer: unknown, levels: number[]): number {
  if (!answer || typeof answer !== 'object') return 0;
  const raw = (answer as { score?: unknown }).score;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 0;
  return levelValue(value, levels);
}

export function normalizeClassWeights(answers: Record<string, unknown>): Record<ClassId, number> {
  const raw = CLASS_IDS.map((id) => readLevelPct(answers[id], CLASS_LEVELS));
  const sum = raw.reduce((total, value) => total + value, 0);
  const weights = {} as Record<ClassId, number>;
  CLASS_IDS.forEach((id, index) => {
    weights[id] = sum > 0 ? (raw[index] / sum) * 100 : id === 'cash' ? 100 : 0;
  });
  return weights;
}

export type SleevePick = {
  symbol: string;
  nameFa: string;
  price: number;
  noul: number;
  sizePct: number;
  /** خلاصهٔ سیگنال‌های عددی نماد برای کاربر */
  whyFa?: string;
};

/** سیگنال‌های قابل‌فهم نماد برای ستون دلیل؛ فقط ارقام موجود. */
export function stockSignalsFa(stock: StockFact): string {
  const parts: string[] = [];
  const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;
  if (stock.r20 != null) parts.push(`روند ۲۰ روزه ${pct(stock.r20)}`);
  if (stock.rf5 != null && Math.abs(stock.rf5) >= 1) {
    parts.push(stock.rf5 > 0 ? `ورود پول حقیقی ${pct(stock.rf5)} حجم ۵ روز` : `خروج پول حقیقی ${pct(stock.rf5)} حجم ۵ روز`);
  }
  if (stock.fh) parts.push(`در سبد ${stock.fh.toLocaleString('fa-IR')} صندوق برتر`);
  if (stock.fb) parts.push(`خرید ${stock.fb.toLocaleString('fa-IR')} صندوق در ماه اخیر`);
  if (stock.fs) parts.push(`فروش ${stock.fs.toLocaleString('fa-IR')} صندوق در ماه اخیر`);
  if (stock.sp != null) parts.push(`امتیاز غربال روزانه ${stock.sp.toLocaleString('fa-IR')}٪`);
  return parts.length ? `${parts.join('، ')}.` : '';
}

export function fillStockSleeve(
  capitalRial: number,
  budgetRial: number,
  picks: SleevePick[],
): Array<{ symbol: string; weightPct: number; amountRial: number; reasonFa: string }> {
  const capital = Math.max(0, capitalRial);
  let remaining = Math.max(0, Math.floor(budgetRial));
  const ranked = [...picks].sort((a, b) => b.noul - a.noul || b.sizePct - a.sizePct);
  const chosen: Array<{ symbol: string; weightPct: number; amountRial: number; reasonFa: string }> = [];
  for (const pick of ranked) {
    if (pick.noul < MIN_STOCK_PROBABILITY) break;
    if (!(pick.price > 0) || pick.sizePct <= 0 || remaining < pick.price) continue;
    const desired = Math.floor((budgetRial * pick.sizePct) / 100);
    const affordable = Math.min(desired, remaining);
    const quantity = Math.floor(affordable / pick.price);
    if (quantity < 1) continue;
    const amountRial = quantity * pick.price;
    remaining -= amountRial;
    const probability = Math.round(pick.noul * 100);
    chosen.push({
      symbol: pick.symbol,
      amountRial,
      weightPct: capital > 0 ? (amountRial / capital) * 100 : 0,
      reasonFa: `احتمال حضور ${probability.toLocaleString('fa-IR')}٪ و اندازه حدود ${pick.sizePct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪ از بخش سهام.${pick.whyFa ? ` ${pick.whyFa}` : ''} قیمت، EPS، نسبت سود به قیمت، روند و رفتار صندوق‌های برتر، به‌همراه طلا، دلار، درس‌آموخته‌ها و اخبار در همین قضاوت بوده‌اند.`,
    });
  }
  return chosen;
}

export type HedgeCandidate = {
  symbol: string;
  nameFa: string;
  underlying: string;
  strike: number;
  premium: number;
  daysLeft: number;
  contractSize: number;
  volume: number | null;
  spot: number;
  heldQty: number;
};

const HEDGE_LEGEND =
  'Option keys: und held stock, k strike, px put premium in rial, d days to expiry, sz shares per contract, vol, spot held stock price, qty shares already held. These are puts only. A missing key is unknown.';

export function hedgeQuestions(
  options: HedgeCandidate[],
): Record<string, { type: 'noul' | 'score'; instructions: string; criteria?: string[] }> {
  const questions: Record<string, { type: 'noul' | 'score'; instructions: string; criteria?: string[] }> = {};
  options.forEach((option, index) => {
    questions[`p${index}`] = {
      type: 'noul',
      instructions: `Buy put ${option.symbol} (options i=${index}) to hedge shares of ${option.underlying} already held? Use strike, premium, days left, and held quantity. This contract only. Do not open a new stock position.`,
    };
    questions[`s${index}`] = {
      type: 'score',
      instructions: `If put ${option.symbol} is used, what percent of the held ${option.underlying} shares should it cover? This contract only.`,
      criteria: SIZE_CRITERIA,
    };
  });
  return questions;
}

export function hedgeState(investor: InvestorState, market: MarketState, options: HedgeCandidate[]): DecisionState {
  return fitDecisionState({
    investor,
    market,
    legend: HEDGE_LEGEND,
    task: 'Choose unexpired puts that hedge stocks the investor already holds. Cover only existing shares. Ignore a contract that does not reduce downside of its underlying.',
    options: options.map((option, index) => compactHedge(option, index)),
  });
}

export type HedgeChoice = {
  underlying: string;
  symbol: string;
  nameFa: string;
  sideFa: string;
  strike: number;
  premium: number;
  daysLeft: number;
  contracts: number;
  coverShares: number;
  coverPct: number;
  probabilityPct: number;
  costRial: number;
  reasonFa: string;
};

export function fillHedge(
  picks: Array<HedgeCandidate & { noul: number; sizePct: number }>,
): HedgeChoice[] {
  const ranked = [...picks].sort((a, b) => b.noul - a.noul || b.sizePct - a.sizePct);
  const covered = new Map<string, number>();
  const chosen: HedgeChoice[] = [];
  for (const pick of ranked) {
    if (pick.noul < MIN_STOCK_PROBABILITY) break;
    if (!(pick.premium > 0) || !(pick.heldQty > 0) || pick.sizePct <= 0) continue;
    const used = covered.get(pick.underlying) ?? 0;
    const room = pick.heldQty - used;
    if (room < 1) continue;
    const wanted = Math.floor((pick.heldQty * pick.sizePct) / 100);
    const unit = pick.contractSize > 0 ? pick.contractSize : 1;
    const contracts = Math.floor(Math.min(wanted, room) / unit);
    if (contracts < 1) continue;
    const coverShares = contracts * unit;
    covered.set(pick.underlying, used + coverShares);
    const probabilityPct = Math.round(pick.noul * 100);
    const coverPct = (coverShares / pick.heldQty) * 100;
    chosen.push({
      underlying: pick.underlying,
      symbol: pick.symbol,
      nameFa: pick.nameFa,
      sideFa: 'اختیار فروش',
      strike: pick.strike,
      premium: pick.premium,
      daysLeft: pick.daysLeft,
      contracts,
      coverShares,
      coverPct,
      probabilityPct,
      costRial: Math.round(contracts * unit * pick.premium),
      reasonFa: `پوشش ${coverShares.toLocaleString('fa-IR')} سهم از ${pick.heldQty.toLocaleString('fa-IR')} سهم ${pick.underlying}. احتمال ${probabilityPct.toLocaleString('fa-IR')}٪ و ${pick.daysLeft.toLocaleString('fa-IR')} روز تا سررسید.`,
    });
  }
  return chosen;
}

function compactHedge(option: HedgeCandidate, index: number): Record<string, string | number> {
  const row: Record<string, string | number> = {
    i: index,
    symbol: option.symbol,
    name: clip(option.nameFa, 32) ?? option.symbol,
    und: option.underlying,
    side: 'PUT',
    k: Math.round(option.strike),
    px: Math.round(option.premium),
    d: Math.round(option.daysLeft),
    sz: option.contractSize > 0 ? Math.round(option.contractSize) : 1,
    spot: Math.round(option.spot),
    qty: Math.round(option.heldQty),
  };
  if (option.volume != null && option.volume > 0) row.vol = Math.round(option.volume);
  return row;
}

export function faPct(value: number): string {
  return value.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
}

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function compactStock(stock: StockFact, index: number): Record<string, string | number> {
  const row: Record<string, string | number> = {
    i: index,
    symbol: stock.symbol,
    name: clip(stock.nameFa, 32) ?? stock.symbol,
    px: Math.round(stock.price),
  };
  const put = (key: string, value: number | null, digits: number) => {
    if (value == null || !Number.isFinite(value)) return;
    row[key] = roundTo(value, digits);
  };
  if (stock.close != null && Math.abs(stock.close - stock.price) >= 1) put('cl', stock.close, 0);
  put('eps', stock.eps, stock.eps != null && Math.abs(stock.eps) < 100 ? 2 : 0);
  put('pe', stock.pe, 2);
  put('ep', stock.ep, 2);
  put('vol', stock.volume, 0);
  put('val', stock.valueRial, 0);
  put('chg', stock.changePct, 2);
  put('hi', stock.high, 0);
  put('lo', stock.low, 0);
  put('n', stock.trades, 0);
  put('rb', stock.realBuy, 0);
  put('rs', stock.realSell, 0);
  put('lb', stock.legalBuy, 0);
  put('ls', stock.legalSell, 0);
  put('spe', stock.sectorPe, 2);
  put('nav', stock.nav, 0);
  put('r5', stock.r5 ?? null, 1);
  put('r20', stock.r20 ?? null, 1);
  put('v20', stock.v20 ?? null, 2);
  put('av20', stock.av20 ?? null, 0);
  put('rf5', stock.rf5 ?? null, 1);
  put('fh', stock.fh ?? null, 0);
  put('fb', stock.fb ?? null, 0);
  put('fs', stock.fs ?? null, 0);
  put('fw', stock.fw ?? null, 2);
  put('sp', stock.sp ?? null, 0);
  return row;
}

/** عدد اول موجود از raw میلهٔ قیمت؛ همان کلیدهای buildStockFact */
export function rawFigure(raw: unknown, keys: string[]): number | null {
  return firstNum(rawRecord(raw), keys);
}

export function compactStockFacts(stock: StockFact): Record<string, string | number> {
  return compactStock(stock, 0);
}

function rawRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function finiteOr(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function firstNum(raw: Record<string, unknown>, keys: string[], allowZero = false): number | null {
  for (const key of keys) {
    const value = raw[key];
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value.replace(/,/g, ''))
          : Number.NaN;
    if (!Number.isFinite(parsed)) continue;
    if (!allowZero && parsed === 0) continue;
    return parsed;
  }
  return null;
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function packState(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, ' ').trim();
    return text || null;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => packState(item))
      .filter((item) => item != null && item !== '' && !(isPlain(item) && Object.keys(item).length === 0));
  }
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = packState(item);
      if (next == null || next === '') continue;
      if (isPlain(next) && Object.keys(next).length === 0) continue;
      out[key] = next;
    }
    return out;
  }
  return value;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fitDecisionState(state: DecisionState): DecisionState {
  const clone = packState(structuredClone(state)) as DecisionState;
  const size = () => Buffer.byteLength(JSON.stringify(clone), 'utf8');
  const clipRows = (rows: Array<Record<string, unknown>> | undefined, key: string, max: number) => {
    if (!rows) return;
    for (const row of rows) {
      const value = row[key];
      if (typeof value === 'string' && value.length > max) row[key] = `${value.slice(0, max)}…`;
    }
  };
  for (const max of [220, 120, 60]) {
    if (size() <= STATE_BYTE_BUDGET) return clone;
    clipRows(clone.market.lessons as unknown as Array<Record<string, unknown>>, 'body', max);
    clipRows(clone.market.iranNews as unknown as Array<Record<string, unknown>>, 'summary', max);
    clipRows(clone.market.opportunities as unknown as Array<Record<string, unknown>>, 'summary', max);
    clipRows(clone.market.worldNews as unknown as Array<Record<string, unknown>>, 'summary', max);
    clipRows(clone.market.worldNews as unknown as Array<Record<string, unknown>>, 'iranImpact', max);
  }
  while (size() > STATE_BYTE_BUDGET) {
    if (clone.market.lessons.length > 3) clone.market.lessons.pop();
    else if (clone.market.iranNews.length > 3) clone.market.iranNews.pop();
    else if (clone.market.worldNews.length > 2) clone.market.worldNews.pop();
    else if (clone.market.opportunities.length > 1) clone.market.opportunities.pop();
    else if (clone.market.recent.length > 2) clone.market.recent.pop();
    else break;
  }
  return clone;
}
