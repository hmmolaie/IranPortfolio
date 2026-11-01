/** تشکیل سبد با مدل تصمیم System One. این مدل متن نمی‌سازد. */

export const CLASS_LEVELS = [0, 5, 10, 15, 20, 30, 40, 55, 75, 100];
export const SIZE_LEVELS = [0, 2, 5, 8, 12, 18, 25, 35, 50, 70];
export const MIN_STOCK_PROBABILITY = 0.5;
export const STOCKS_PER_CALL = 16;
const STATE_BYTE_BUDGET = 45_000;

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
  volume: number | null;
  pe: number | null;
};

type DecisionState = {
  investor: InvestorState;
  market: MarketState;
  task: string;
  stocks?: Array<{
    i: number;
    symbol: string;
    name: string;
    price: number;
    volume?: number;
    pe?: number;
  }>;
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
    const who = `${stock.symbol} (${stock.nameFa})`;
    questions[`p${index}`] = {
      type: 'noul',
      instructions: `Should ${who} be included in this investor's stock sleeve? Weigh the profile, strategy, current gold and dollar prices, lessons, Iran news, and world news in the state. Judge only this stock.`,
      criteria: {
        true: 'This stock belongs in the portfolio.',
        false: 'This stock should stay out.',
      },
    };
    questions[`s${index}`] = {
      type: 'score',
      instructions: `If ${who} is included, how large should it be inside the stock sleeve? Use the same gold, dollar, lesson, and news context. Score only this stock.`,
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
    task: 'For each listed stock, decide inclusion and size. Use gold and dollar prices, lessons, Iran news, and world news. Do not assume a stock is attractive only because it was mentioned in a headline.',
    stocks: stocks.map((stock, index) => ({
      i: index,
      symbol: stock.symbol,
      name: clip(stock.nameFa, 48) ?? stock.symbol,
      price: Math.round(stock.price),
      ...(stock.volume != null && stock.volume > 0 ? { volume: Math.round(stock.volume) } : {}),
      ...(stock.pe != null && Number.isFinite(stock.pe) ? { pe: Math.round(stock.pe * 10) / 10 } : {}),
    })),
  });
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
      reasonFa: `احتمال حضور ${probability.toLocaleString('fa-IR')}٪ و اندازه حدود ${pick.sizePct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪ از بخش سهام. قیمت طلا و دلار، درس‌آموخته‌ها و اخبار ایران و جهان در همین قضاوت بوده‌اند.`,
    });
  }
  return chosen;
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

function fitDecisionState(state: DecisionState): DecisionState {
  const clone = structuredClone(state);
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
