/** تشکیل سبد با مدل تصمیم System One. این مدل متن نمی‌سازد. */

export const CLASS_LEVELS = [0, 5, 10, 15, 20, 30, 40, 55, 75, 100];
export const SIZE_LEVELS = [0, 2, 5, 8, 12, 18, 25, 35, 50, 70];
export const MIN_STOCK_PROBABILITY = 0.5;
export const STOCKS_PER_CALL = 8;
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
};

const STOCK_LEGEND =
  'Stock keys: px last price in rial, cl close if different, eps, pe price/eps, ep earnings yield percent (eps/price*100), vol shares, val turnover rial, chg percent versus previous close, hi lo day high and low, n trade count, rb rs real-person buy and sell volume, lb ls legal-person buy and sell volume, spe sector pe, nav fund nav. A missing key is unknown.';

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
      instructions: `Include ${who} (stocks i=${index})? Use its px, eps, pe, ep and the other figures in the legend, plus profile, gold, dollar, lessons, and news. This symbol only.`,
    };
    questions[`s${index}`] = {
      type: 'score',
      instructions: `If ${who} (stocks i=${index}) is included, how large inside the stock sleeve? Use the same figures. This symbol only.`,
      criteria: SIZE_CRITERIA,
    };
  });
  return questions;
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
};

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
      reasonFa: `احتمال حضور ${probability.toLocaleString('fa-IR')}٪ و اندازه حدود ${pick.sizePct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪ از بخش سهام. قیمت، EPS، نسبت سود به قیمت و بقیهٔ ارقام نماد، به‌همراه طلا، دلار، درس‌آموخته‌ها و اخبار در همین قضاوت بوده‌اند.`,
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
  return row;
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
