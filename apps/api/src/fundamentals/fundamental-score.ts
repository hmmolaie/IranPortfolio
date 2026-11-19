/**
 * نسبت‌های مالی و امتیاز بنیادی از ارقام استخراج‌شدهٔ صورت مالی و آخرین قیمت.
 * محاسبه در کد است تا عدد مدل زبانی فقط ورودی باشد، نه نتیجه.
 * قدمت گزارش امتیاز را به سمت خنثی (۵۰) می‌کشد: گزارش قدیمی کم‌اثرتر است.
 */
import {
  MACRO_DRIVER_LABELS_FA,
  type FinancialFigures,
  type FundamentalSensitivity,
  type MacroDriverKey,
} from '@sabadyar/shared';
import { jalaliDaysAgo } from '../market/option-board';
import type { MacroDriver } from './macro-drivers';

export type FundamentalRatios = {
  /** ضریب سالانه‌سازی ارقام جریانی (۱۲ تقسیم بر طول دوره) */
  annualFactor: number;
  shares: number | null;
  epsAnnual: number | null;
  bvps: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  dividendYield: number | null;
  cashPerShare: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
  debtToEquity: number | null;
  borrowingsToEquity: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  revenueGrowth: number | null;
  profitGrowth: number | null;
  epsGrowth: number | null;
  ocfToProfit: number | null;
  freeCashFlow: number | null;
  inventoryToCurrentAssets: number | null;
  receivableDays: number | null;
};

export type ScoreParts = {
  valuation: number | null;
  profitability: number | null;
  growth: number | null;
  health: number | null;
  llm: number | null;
};

export type FundamentalScore = {
  /** امتیاز خام ۰ تا ۱۰۰ بدون قدمت */
  raw: number | null;
  /** امتیاز پس از اثر قدمت گزارش؛ مبنای رتبه‌بندی */
  effective: number | null;
  parts: ScoreParts;
  ageDays: number | null;
  ageMonths: number | null;
  /** وزن تازگی ۰٫۲ تا ۱ */
  freshness: number;
  stale: boolean;
  reasonsFa: string[];
  cautionsFa: string[];
};

export type MacroImpact = {
  /** جمع وزن‌دار حساسیت در تغییر یک‌ماهه؛ مثبت یعنی تغییرات اخیر به نفع سود شرکت است */
  score: number;
  lines: Array<{ key: MacroDriverKey; labelFa: string; sensitivity: number; changePct: number; effect: number }>;
  summaryFa: string | null;
};

/** گزارشی که پایان دوره‌اش بیش از این قدیمی است در رتبه‌بندی نمی‌آید */
export const STALE_MONTHS = 30;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!finite(a) || !finite(b) || b === 0) return null;
  return a / b;
}

function pct(a: number | null | undefined, b: number | null | undefined): number | null {
  const r = div(a, b);
  return r == null ? null : r * 100;
}

function growth(now: number | null | undefined, before: number | null | undefined): number | null {
  if (!finite(now) || !finite(before) || before <= 0) return null;
  return (now / before - 1) * 100;
}

export function parsePeriodEnd(fa: string | null | undefined): { key: number; jy: number; jm: number; jd: number } | null {
  if (!fa) return null;
  const latin = fa.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const m = latin.match(/(1[34]\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  return { key: jy * 10_000 + jm * 100 + jd, jy, jm, jd };
}

export function periodEndFromKey(key: number | null | undefined): string | null {
  if (!key) return null;
  const jy = Math.floor(key / 10_000);
  const jm = Math.floor((key % 10_000) / 100);
  const jd = key % 100;
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}

/** عدد یا متن عددی مدل؛ ارقام فارسی، جداکننده و پرانتز (منفی) هم پذیرفته می‌شود */
function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const latin = v
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();
  const negative = /^\(.*\)$/.test(latin) || latin.startsWith('-');
  const digits = latin.replace(/[^\d.]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export function normalizeFigures(raw: unknown): FinancialFigures {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: FinancialFigures = {};
  const keys: Array<keyof FinancialFigures> = [
    'revenue', 'costOfRevenue', 'grossProfit', 'operatingProfit', 'financeCost', 'netProfit', 'netProfitParent',
    'eps', 'dps', 'cash', 'shortTermInvestments', 'receivables', 'inventory', 'prepayments', 'currentAssets',
    'fixedAssets', 'totalAssets', 'currentLiabilities', 'totalLiabilities', 'borrowings', 'equity', 'capital',
    'retainedEarnings', 'operatingCashFlow', 'capex', 'shares', 'prevRevenue', 'prevNetProfit', 'prevEps',
    'prevOperatingProfit', 'exportSalesPct',
  ];
  for (const k of keys) {
    const n = parseAmount(src[k]);
    if (n != null) out[k] = n;
  }
  // هزینه‌ها گاهی با علامت منفی می‌آیند
  if (out.capex != null) out.capex = Math.abs(out.capex);
  if (out.costOfRevenue != null) out.costOfRevenue = Math.abs(out.costOfRevenue);
  if (out.financeCost != null) out.financeCost = Math.abs(out.financeCost);
  return out;
}

export function normalizeSensitivity(raw: unknown): FundamentalSensitivity {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: FundamentalSensitivity = {};
  for (const k of Object.keys(MACRO_DRIVER_LABELS_FA) as MacroDriverKey[]) {
    const n = num(typeof src[k] === 'string' ? Number(src[k]) : src[k]);
    if (n != null) out[k] = Math.max(-2, Math.min(2, Math.round(n * 2) / 2));
  }
  if (typeof src.noteFa === 'string' && src.noteFa.trim()) out.noteFa = src.noteFa.trim().slice(0, 400);
  return out;
}

export function computeRatios(
  f: FinancialFigures,
  periodMonths: number | null | undefined,
  price: number | null | undefined,
): FundamentalRatios {
  const months = periodMonths && periodMonths > 0 && periodMonths <= 12 ? periodMonths : 12;
  const annualFactor = 12 / months;
  // ارزش اسمی هر سهم در بورس تهران ۱۰۰۰ ریال است؛ سرمایه به میلیون ریال
  const shares = finite(f.shares) && f.shares > 0 ? f.shares : finite(f.capital) && f.capital > 0 ? f.capital * 1_000 : null;
  const parentProfit = f.netProfitParent ?? f.netProfit ?? null;
  const eps = finite(f.eps) ? f.eps : finite(parentProfit) && shares ? (parentProfit * 1e6) / shares : null;
  const epsAnnual = eps != null ? eps * annualFactor : null;
  const bvps = finite(f.equity) && shares ? (f.equity * 1e6) / shares : null;
  const p = finite(price) && price > 0 ? price : null;
  const revenueAnnual = finite(f.revenue) ? f.revenue * annualFactor : null;
  const quick =
    finite(f.currentAssets) ? f.currentAssets - (f.inventory ?? 0) - (f.prepayments ?? 0) : null;
  const cashLike = finite(f.cash) ? f.cash + (f.shortTermInvestments ?? 0) : null;
  return {
    annualFactor,
    shares,
    epsAnnual,
    bvps,
    pe: p && epsAnnual && epsAnnual > 0 ? p / epsAnnual : null,
    pb: p && bvps && bvps > 0 ? p / bvps : null,
    ps: p && shares && revenueAnnual && revenueAnnual > 0 ? (p * shares) / (revenueAnnual * 1e6) : null,
    dividendYield: p && finite(f.dps) && f.dps > 0 ? (f.dps / p) * 100 : null,
    cashPerShare: cashLike != null && shares ? (cashLike * 1e6) / shares : null,
    currentRatio: div(f.currentAssets, f.currentLiabilities),
    quickRatio: div(quick, f.currentLiabilities),
    cashRatio: div(cashLike, f.currentLiabilities),
    debtToEquity: f.equity && f.equity > 0 ? div(f.totalLiabilities, f.equity) : null,
    borrowingsToEquity: f.equity && f.equity > 0 ? div(f.borrowings, f.equity) : null,
    grossMargin: pct(f.grossProfit, f.revenue),
    operatingMargin: pct(f.operatingProfit, f.revenue),
    netMargin: pct(f.netProfit, f.revenue),
    roe: f.equity && f.equity > 0 && finite(parentProfit) ? ((parentProfit * annualFactor) / f.equity) * 100 : null,
    roa: f.totalAssets && f.totalAssets > 0 && finite(f.netProfit) ? ((f.netProfit * annualFactor) / f.totalAssets) * 100 : null,
    revenueGrowth: growth(f.revenue, f.prevRevenue),
    profitGrowth: growth(f.netProfit, f.prevNetProfit),
    epsGrowth: growth(f.eps, f.prevEps),
    ocfToProfit: finite(f.netProfit) && f.netProfit > 0 ? div(f.operatingCashFlow, f.netProfit) : null,
    freeCashFlow: finite(f.operatingCashFlow) ? f.operatingCashFlow - (f.capex ?? 0) : null,
    inventoryToCurrentAssets: pct(f.inventory, f.currentAssets),
    receivableDays:
      finite(f.receivables) && revenueAnnual && revenueAnnual > 0 ? (f.receivables / revenueAnnual) * 365 : null,
  };
}

function weighted(parts: Array<[number | null, number]>): number | null {
  const ok = parts.filter((p): p is [number, number] => p[0] != null);
  const w = ok.reduce((s, p) => s + p[1], 0);
  return w > 0 ? ok.reduce((s, p) => s + p[0] * p[1], 0) / w : null;
}

/** تازگی گزارش: تا ۶ ماه کامل، تا ۲۴ ماه به ۰٫۳۵ و تا ۳۶ ماه به ۰٫۲ می‌رسد */
export function freshnessWeight(ageMonths: number | null): number {
  if (ageMonths == null) return 0.5;
  if (ageMonths <= 6) return 1;
  if (ageMonths <= 24) return 1 - ((ageMonths - 6) / 18) * 0.65;
  return Math.max(0.2, 0.35 - ((ageMonths - 24) / 12) * 0.15);
}

const fmt = (v: number, digits = 1) => v.toLocaleString('fa-IR', { maximumFractionDigits: digits });

export function scoreFundamentals(
  r: FundamentalRatios,
  f: FinancialFigures,
  periodEndKey: number | null | undefined,
  llmScore: number | null | undefined,
  now = new Date(),
): FundamentalScore {
  const reasonsFa: string[] = [];
  const cautionsFa: string[] = [];

  let valuation: number | null = null;
  if (r.epsAnnual != null && r.epsAnnual <= 0) {
    valuation = 0;
    cautionsFa.push('زیان‌ده در این دوره');
  } else if (r.pe != null) {
    const peScore = 1 - clamp01((r.pe - 4) / 16);
    const pbScore = r.pb != null ? 1 - clamp01((r.pb - 1) / 7) : null;
    valuation = weighted([[peScore, 0.8], [pbScore, 0.2]]);
    if (r.pe <= 6) reasonsFa.push(`P/E پایین (${fmt(r.pe)}) بر پایهٔ سود سالانه‌شده`);
    else if (r.pe >= 15) cautionsFa.push(`P/E بالا (${fmt(r.pe)})`);
  }

  const roeScore = r.roe != null ? clamp01((r.roe - 5) / 45) : null;
  const marginScore = r.netMargin != null ? clamp01(r.netMargin / 30) : null;
  const profitability = weighted([[roeScore, 0.6], [marginScore, 0.4]]);
  if (r.roe != null && r.roe >= 35) reasonsFa.push(`بازده حقوق صاحبان سهام ${fmt(r.roe, 0)}٪`);
  if (r.netMargin != null && r.netMargin >= 25) reasonsFa.push(`حاشیهٔ سود خالص ${fmt(r.netMargin, 0)}٪`);
  if (r.netMargin != null && r.netMargin < 5) cautionsFa.push(`حاشیهٔ سود خالص کم (${fmt(r.netMargin, 1)}٪)`);

  // تورم بالای ایران: رشد اسمی زیر حدود ۳۰٪ رشد واقعی نیست
  const pgScore = r.profitGrowth != null ? clamp01((r.profitGrowth + 10) / 90) : null;
  const rgScore = r.revenueGrowth != null ? clamp01(r.revenueGrowth / 70) : null;
  const growthScore = weighted([[pgScore, 0.6], [rgScore, 0.4]]);
  if (r.profitGrowth != null && r.profitGrowth >= 50) reasonsFa.push(`رشد سود خالص ${fmt(r.profitGrowth, 0)}٪ نسبت به دورهٔ مشابه`);
  if (r.profitGrowth != null && r.profitGrowth < 0) cautionsFa.push(`افت سود خالص ${fmt(Math.abs(r.profitGrowth), 0)}٪`);
  if (r.revenueGrowth != null && r.revenueGrowth >= 50) reasonsFa.push(`رشد فروش ${fmt(r.revenueGrowth, 0)}٪`);

  const crScore = r.currentRatio != null ? clamp01((r.currentRatio - 0.7) / 1.0) : null;
  const deScore = r.debtToEquity != null ? 1 - clamp01((r.debtToEquity - 0.3) / 1.7) : null;
  const ocfScore = r.ocfToProfit != null ? clamp01(r.ocfToProfit) : null;
  const health = weighted([[crScore, 0.35], [deScore, 0.35], [ocfScore, 0.3]]);
  if (r.currentRatio != null && r.currentRatio < 1) cautionsFa.push(`نسبت جاری زیر ۱ (${fmt(r.currentRatio, 2)})`);
  if (r.debtToEquity != null && r.debtToEquity > 1.5) cautionsFa.push(`بدهی ${fmt(r.debtToEquity, 1)} برابر حقوق مالکانه`);
  if (r.ocfToProfit != null && r.ocfToProfit >= 1) reasonsFa.push('جریان نقد عملیاتی بیشتر از سود؛ کیفیت سود خوب');
  if (r.ocfToProfit != null && r.ocfToProfit < 0.5) cautionsFa.push('جریان نقد عملیاتی کمتر از نصف سود');
  if (r.dividendYield != null && r.dividendYield >= 8) reasonsFa.push(`بازده سود نقدی ${fmt(r.dividendYield, 0)}٪`);
  if (r.inventoryToCurrentAssets != null && r.inventoryToCurrentAssets > 50) {
    cautionsFa.push(`موجودی انبار ${fmt(r.inventoryToCurrentAssets, 0)}٪ دارایی جاری`);
  }
  if (f.exportSalesPct != null && f.exportSalesPct >= 40) reasonsFa.push(`فروش صادراتی ${fmt(f.exportSalesPct, 0)}٪`);

  const llm = finite(llmScore) ? clamp01(llmScore / 10) : null;
  const quant = weighted([
    [valuation, 30],
    [profitability, 25],
    [growthScore, 20],
    [health, 25],
  ]);
  const blended = quant == null ? llm : weighted([[quant, 0.85], [llm, 0.15]]);
  const raw = blended == null ? null : Math.round(blended * 100);

  let ageDays: number | null = null;
  if (periodEndKey) {
    const jy = Math.floor(periodEndKey / 10_000);
    const jm = Math.floor((periodEndKey % 10_000) / 100);
    const jd = periodEndKey % 100;
    ageDays = jalaliDaysAgo(jy, jm, jd, now);
  }
  const ageMonths = ageDays != null ? Math.max(0, Math.round(ageDays / 30.4)) : null;
  const freshness = freshnessWeight(ageMonths);
  const effective = raw == null ? null : Math.round(50 + (raw - 50) * freshness);
  const stale = ageMonths != null && ageMonths > STALE_MONTHS;
  if (ageMonths != null && ageMonths > 12) cautionsFa.push(`گزارش ${fmt(ageMonths, 0)} ماه پیش تمام شده؛ اثرش کمتر لحاظ شد`);

  const pct100 = (v: number | null) => (v == null ? null : Math.round(v * 100));
  return {
    raw,
    effective,
    parts: {
      valuation: pct100(valuation),
      profitability: pct100(profitability),
      growth: pct100(growthScore),
      health: pct100(health),
      llm: pct100(llm),
    },
    ageDays,
    ageMonths,
    freshness: Math.round(freshness * 100) / 100,
    stale,
    reasonsFa,
    cautionsFa,
  };
}

/** اثر تغییر یک‌ماههٔ دلار و کالاها بر سود شرکت، از حساسیتی که مدل از صورت مالی خوانده */
export function macroImpact(sensitivity: FundamentalSensitivity | null | undefined, drivers: MacroDriver[]): MacroImpact | null {
  if (!sensitivity || !drivers.length) return null;
  const lines: MacroImpact['lines'] = [];
  for (const d of drivers) {
    const s = sensitivity[d.key];
    if (!s) continue;
    // تغییر بیش از ۲۰٪ در یک ماه سقف می‌خورد تا یک عامل همه‌چیز را نبرد
    const change = Math.max(-20, Math.min(20, d.changePct));
    lines.push({ key: d.key, labelFa: d.labelFa, sensitivity: s, changePct: d.changePct, effect: s * change });
  }
  if (!lines.length) return { score: 0, lines, summaryFa: null };
  const score = Math.round(lines.reduce((sum, l) => sum + l.effect, 0) * 10) / 10;
  const top = [...lines].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 2);
  const words = top.map(
    (l) => `${l.labelFa} ${l.changePct >= 0 ? 'بالا رفته' : 'پایین آمده'} (${fmt(Math.abs(l.changePct), 1)}٪ در یک ماه) و حساسیت سود ${l.sensitivity > 0 ? 'مثبت' : 'منفی'} است`,
  );
  const tone = score >= 3 ? 'به نفع سود شرکت' : score <= -3 ? 'به زیان سود شرکت' : 'اثر خالص کم';
  return { score, lines, summaryFa: `${words.join('؛ ')}. جمع‌بندی: ${tone}.` };
}
