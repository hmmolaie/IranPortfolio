/** قواعد قابل حسابرسی. عددها فقط از ورودی محاسبه می‌شوند. */

export const CLASS_KEYS = ['equity', 'fixed', 'gold', 'usd', 'cash'] as const;
export type ClassKey = (typeof CLASS_KEYS)[number];
export type Level = 'LOW' | 'MEDIUM' | 'HIGH';
export type RegimeCode =
  | 'RISK_ON'
  | 'RISK_OFF'
  | 'INFLATIONARY'
  | 'DEFENSIVE'
  | 'CRISIS'
  | 'NEUTRAL';

export const CLASS_LABEL_FA: Record<ClassKey, string> = {
  equity: 'سهام',
  fixed: 'درآمد ثابت و صندوق',
  gold: 'طلا',
  usd: 'دلار',
  cash: 'نقد',
};

export const REGIME_LABEL_FA: Record<RegimeCode, string> = {
  RISK_ON: 'ریسک‌پذیری',
  RISK_OFF: 'ریسک‌گریزی',
  INFLATIONARY: 'تورمی',
  DEFENSIVE: 'دفاعی',
  CRISIS: 'بحرانی',
  NEUTRAL: 'خنثی',
};

export const LEVEL_FA: Record<Level, string> = {
  LOW: 'کم',
  MEDIUM: 'متوسط',
  HIGH: 'زیاد',
};

export const METHODOLOGY_FA = {
  regime:
    'رژیم فقط وقتی دست‌کم دو نشانه از دادهٔ موجود هم‌جهت باشند انتخاب می‌شود. اگر نشانه کم باشد، رژیم خنثی می‌ماند.',
  confidence:
    'اطمینان از تعداد نشانه‌های واقعی است و از ۸۵ درصد بالاتر نمی‌رود، چون پهنای بازار و ارزش‌گذاری در این محاسبه نیست.',
  target:
    'وزن هدف از تحمل ریسک اعلام‌شده شروع می‌شود. فقط اگر رژیم با اطمینان کافی باشد، چند واحد به طلا، نقد یا سهام جابه‌جا می‌شود و دوباره به ۱۰۰ می‌رسد.',
  risk: 'ریسک از تمرکز وزن‌ها، سهم سهام، سهم دلار و سهم نقد در همین سبد است، نه از پیش‌بینی بازده.',
  health: 'سلامت میانگین جزءهایی است که داده دارند. جزء بدون داده در میانگین نمی‌آید.',
  scenario:
    'اثر سناریو حساب مستقیم فرض شما روی همان کلاس است. همبستگی بین کلاس‌ها محاسبه نشده و نتیجه آینده را تضمین نمی‌کند.',
};

export type MarketFacts = {
  usdChangePct: number | null;
  goldChangePct: number | null;
  interestRatePct: number | null;
  interestRateChangePoints: number | null;
  inflationPct: number | null;
  geoRiskScore: number | null;
  newsBearish: number;
  newsBullish: number;
};

export type Driver = { code: string; labelFa: string; direction: 'up' | 'down' };

export type DnaInput = {
  riskTolerance: number;
  horizonMonths: number;
  liquidityNeed: Level | null;
  maxDrawdownPct: number | null;
  inflationSensitivity: Level | null;
  fxSensitivity: Level | null;
  weights: Record<ClassKey, number>;
};

const BASE_BY_RISK: Record<'low' | 'mid' | 'high', Record<ClassKey, number>> = {
  low: { equity: 20, fixed: 40, gold: 15, usd: 10, cash: 15 },
  mid: { equity: 40, fixed: 25, gold: 15, usd: 10, cash: 10 },
  high: { equity: 55, fixed: 15, gold: 12, usd: 8, cash: 10 },
};

export function bucketAsset(assetType: string): ClassKey {
  if (assetType === 'GOLD_ETF' || assetType === 'PHYSICAL_GOLD') return 'gold';
  if (assetType === 'PHYSICAL_USD') return 'usd';
  if (assetType === 'CASH') return 'cash';
  if (assetType === 'DEPOSIT' || assetType === 'FUND') return 'fixed';
  return 'equity';
}

export function weightsFromAmounts(rows: Array<{ assetType: string; amountRial: number }>): Record<ClassKey, number> {
  const sums: Record<ClassKey, number> = { equity: 0, fixed: 0, gold: 0, usd: 0, cash: 0 };
  for (const row of rows) {
    const amount = Number(row.amountRial);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    sums[bucketAsset(row.assetType)] += amount;
  }
  const total = CLASS_KEYS.reduce((s, k) => s + sums[k], 0);
  const out: Record<ClassKey, number> = { equity: 0, fixed: 0, gold: 0, usd: 0, cash: 0 };
  if (total <= 0) return out;
  let acc = 0;
  CLASS_KEYS.forEach((k, i) => {
    if (i === CLASS_KEYS.length - 1) out[k] = round1(Math.max(0, 100 - acc));
    else {
      out[k] = round1((sums[k] / total) * 100);
      acc += out[k];
    }
  });
  return out;
}

export function levelFromShare(pct: number, low: number, high: number): Level {
  if (pct >= high) return 'HIGH';
  if (pct >= low) return 'MEDIUM';
  return 'LOW';
}

export function horizonBand(months: number): 'SHORT' | 'MEDIUM' | 'LONG' {
  if (months < 12) return 'SHORT';
  if (months < 36) return 'MEDIUM';
  return 'LONG';
}

export function buildDna(input: DnaInput) {
  const risk = clamp(Math.round(input.riskTolerance), 1, 10);
  const observedLiquidity = levelFromShare(input.weights.cash, 8, 20);
  const fxExposure = levelFromShare(input.weights.usd, 8, 20);
  return {
    riskScore: risk,
    horizon: horizonBand(input.horizonMonths),
    horizonMonths: input.horizonMonths,
    liquidityNeed: input.liquidityNeed,
    liquiditySource: input.liquidityNeed ? 'declared' : 'not_declared',
    observedCashLevel: observedLiquidity,
    maxDrawdownPct: input.maxDrawdownPct,
    inflationSensitivity: input.inflationSensitivity,
    fxSensitivity: input.fxSensitivity,
    fxExposure,
    cashShare: round1(input.weights.cash),
  };
}

export function classifyRegime(facts: MarketFacts): {
  regime: RegimeCode;
  confidence: number | null;
  drivers: Driver[];
  summaryFa: string;
  enough: boolean;
} {
  const drivers: Driver[] = [];
  if (facts.usdChangePct != null && facts.usdChangePct >= 3) {
    drivers.push({ code: 'usd', labelFa: 'دلار در بازهٔ موجود بالا رفته', direction: 'up' });
  } else if (facts.usdChangePct != null && facts.usdChangePct <= -3) {
    drivers.push({ code: 'usd', labelFa: 'دلار در بازهٔ موجود پایین آمده', direction: 'down' });
  }
  if (facts.interestRateChangePoints != null && facts.interestRateChangePoints >= 0.5) {
    drivers.push({ code: 'rate', labelFa: 'نرخ بهره نسبت به ثبت قبلی بالا رفته', direction: 'up' });
  } else if (facts.interestRateChangePoints != null && facts.interestRateChangePoints <= -0.5) {
    drivers.push({ code: 'rate', labelFa: 'نرخ بهره نسبت به ثبت قبلی پایین آمده', direction: 'down' });
  }
  if (facts.geoRiskScore != null && facts.geoRiskScore >= 7) {
    drivers.push({ code: 'geo', labelFa: 'ریسک اقتصادی ثبت‌شده بالا است', direction: 'up' });
  } else if (facts.geoRiskScore != null && facts.geoRiskScore <= 3) {
    drivers.push({ code: 'geo', labelFa: 'ریسک اقتصادی ثبت‌شده پایین است', direction: 'down' });
  }
  if (facts.goldChangePct != null && facts.goldChangePct >= 3) {
    drivers.push({ code: 'gold', labelFa: 'طلا در بازهٔ موجود بالا رفته', direction: 'up' });
  } else if (facts.goldChangePct != null && facts.goldChangePct <= -3) {
    drivers.push({ code: 'gold', labelFa: 'طلا در بازهٔ موجود پایین آمده', direction: 'down' });
  }
  if (facts.newsBearish >= 2 && facts.newsBearish > facts.newsBullish + 1) {
    drivers.push({ code: 'news', labelFa: 'جهت اثر اخبار موجود بیشتر منفی است', direction: 'up' });
  } else if (facts.newsBullish >= 2 && facts.newsBullish > facts.newsBearish + 1) {
    drivers.push({ code: 'news', labelFa: 'جهت اثر اخبار موجود بیشتر مثبت است', direction: 'down' });
  }

  const riskOff = drivers.filter((d) => d.direction === 'up').length;
  const riskOn = drivers.filter((d) => d.direction === 'down').length;
  const goldUp = drivers.some((d) => d.code === 'gold' && d.direction === 'up');
  const usdUp = drivers.some((d) => d.code === 'usd' && d.direction === 'up');
  const enough = drivers.length >= 2;

  let regime: RegimeCode = 'NEUTRAL';
  if (enough) {
    if ((facts.geoRiskScore ?? 0) >= 8 && riskOff >= 2) regime = 'CRISIS';
    else if (goldUp && usdUp && riskOff >= 1) regime = 'INFLATIONARY';
    else if (riskOff >= 2 && riskOff > riskOn) regime = 'RISK_OFF';
    else if (riskOn >= 2 && riskOn > riskOff) regime = 'RISK_ON';
    else if (riskOff === 1 && riskOn === 0) regime = 'DEFENSIVE';
  }

  const confidence = enough ? round2(Math.min(0.85, 0.35 + drivers.length * 0.1)) : null;
  const summaryFa = enough
    ? `رژیم ${REGIME_LABEL_FA[regime]} از ${drivers.length.toLocaleString('fa-IR')} نشانهٔ موجود.`
    : 'داده برای تشخیص رژیم بازار کافی نیست؛ رژیم خنثی مانده است.';
  return { regime, confidence, drivers, summaryFa, enough };
}

export function buildPlan(input: {
  riskTolerance: number;
  weights: Record<ClassKey, number>;
  regime: RegimeCode;
  confidence: number | null;
  drivers: Driver[];
}) {
  const band = input.riskTolerance <= 3 ? 'low' : input.riskTolerance >= 7 ? 'high' : 'mid';
  const base = { ...BASE_BY_RISK[band] };
  const tilt = input.confidence != null && input.confidence >= 0.45 && input.regime !== 'NEUTRAL';
  if (tilt) {
    if (input.regime === 'RISK_OFF' || input.regime === 'DEFENSIVE' || input.regime === 'CRISIS') {
      base.equity -= 8;
      base.gold += 4;
      base.cash += 4;
    } else if (input.regime === 'RISK_ON') {
      base.equity += 6;
      base.cash -= 3;
      base.gold -= 3;
    } else if (input.regime === 'INFLATIONARY') {
      base.gold += 5;
      base.usd += 3;
      base.equity -= 4;
      base.fixed -= 4;
    }
  }
  const target = renormalize(base);
  const reason = tilt
    ? input.drivers.map((d) => d.labelFa).join('؛ ')
    : 'رژیم با اطمینان کافی تشخیص داده نشد. هدف فقط از تحمل ریسک اعلام‌شده آمده است.';
  const lines = CLASS_KEYS.map((asset) => {
    const currentPct = round1(input.weights[asset] || 0);
    const targetPct = target[asset];
    const diffPct = round1(targetPct - currentPct);
    const action = diffPct >= 2 ? 'INCREASE' : diffPct <= -2 ? 'DECREASE' : 'HOLD';
    return {
      asset,
      labelFa: CLASS_LABEL_FA[asset],
      currentPct,
      targetPct,
      diffPct,
      action,
      reasonFa: reason,
      confidence: tilt ? input.confidence : null,
      basis: tilt ? 'model_rule' : 'declared_risk_only',
    };
  });
  return { lines, tilted: tilt };
}

export function scoreRisk(weights: Record<ClassKey, number>, inflationKnown: boolean) {
  const total = CLASS_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  if (total <= 0) {
    return {
      score: null as number | null,
      parts: [] as Array<{ code: string; labelFa: string; level: Level | null; detailFa: string }>,
      noteFa: 'سبد خالی است و ریسک قابل محاسبه نیست.',
    };
  }
  const hhi = CLASS_KEYS.reduce((s, k) => s + (weights[k] / 100) ** 2, 0);
  const top = Math.max(...CLASS_KEYS.map((k) => weights[k]));
  const concentration = hhi >= 0.35 || top >= 45 ? 'HIGH' : hhi >= 0.22 || top >= 30 ? 'MEDIUM' : 'LOW';
  const market = levelFromShare(weights.equity, 30, 55);
  const fx = levelFromShare(weights.usd, 8, 20);
  const liquidityRisk: Level = weights.cash < 5 ? 'HIGH' : weights.cash < 15 ? 'MEDIUM' : 'LOW';
  const hedge = weights.gold + weights.usd;
  const inflation: Level | null = inflationKnown
    ? hedge < 10
      ? 'HIGH'
      : hedge < 25
        ? 'MEDIUM'
        : 'LOW'
    : null;
  const parts = [
    {
      code: 'concentration',
      labelFa: 'تمرکز',
      level: concentration as Level,
      detailFa: `بزرگ‌ترین کلاس ${round1(top).toLocaleString('fa-IR')} درصد سبد است.`,
    },
    {
      code: 'market',
      labelFa: 'ریسک بازار',
      level: market,
      detailFa: `سهم سهام ${round1(weights.equity).toLocaleString('fa-IR')} درصد است.`,
    },
    {
      code: 'fx',
      labelFa: 'ریسک ارز',
      level: fx,
      detailFa: `سهم دلار ${round1(weights.usd).toLocaleString('fa-IR')} درصد است.`,
    },
    {
      code: 'liquidity',
      labelFa: 'ریسک نقدشوندگی',
      level: liquidityRisk,
      detailFa: `سهم نقد ${round1(weights.cash).toLocaleString('fa-IR')} درصد است.`,
    },
    {
      code: 'inflation',
      labelFa: 'ریسک تورم',
      level: inflation,
      detailFa: inflation
        ? `پوشش طلا و دلار ${round1(hedge).toLocaleString('fa-IR')} درصد است و تورم در دادهٔ کلان ثبت شده.`
        : 'تورم در دادهٔ کلان ثبت نشده و این جزء محاسبه نشد.',
    },
  ];
  const scored = parts.filter((p) => p.level);
  const map = { LOW: 3, MEDIUM: 6, HIGH: 8 };
  const score = scored.length
    ? round1(scored.reduce((s, p) => s + map[p.level as Level], 0) / scored.length)
    : null;
  return {
    score,
    parts,
    noteFa: 'نوسان و افت تاریخی فقط وقتی جداگانه دادهٔ کافی باشد گفته می‌شود.',
  };
}

export function maxDrawdownPct(values: number[]): { pct: number | null; noteFa: string } {
  const series = values.filter((v) => Number.isFinite(v) && v > 0);
  if (series.length < 5) {
    return { pct: null, noteFa: 'برای افت تاریخی حداقل پنج ارزش ثبت‌شده لازم است.' };
  }
  let peak = series[0];
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > worst) worst = dd;
  }
  return {
    pct: round1(worst * 100),
    noteFa: 'افت از ارزش‌های ثبت‌شدهٔ همین سبد است، نه از شاخص بازار.',
  };
}

export function healthScore(weights: Record<ClassKey, number>, riskScore: number | null) {
  const total = CLASS_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  if (total <= 0) {
    return { score: null as number | null, parts: [] as Array<{ code: string; labelFa: string; score: number; detailFa: string }> };
  }
  const hhi = CLASS_KEYS.reduce((s, k) => s + (weights[k] / 100) ** 2, 0);
  const top = Math.max(...CLASS_KEYS.map((k) => weights[k]));
  const parts = [
    {
      code: 'diversification',
      labelFa: 'پراکندگی',
      score: clamp(Math.round((1 - hhi) * 100), 0, 100),
      detailFa: 'از پخش وزن بین پنج کلاس دارایی.',
    },
    {
      code: 'concentration',
      labelFa: 'عدم تمرکز',
      score: clamp(Math.round(100 - top), 0, 100),
      detailFa: `بزرگ‌ترین کلاس ${round1(top).toLocaleString('fa-IR')} درصد است.`,
    },
    {
      code: 'liquidity',
      labelFa: 'نقدشوندگی',
      score: clamp(Math.round(Math.min(100, weights.cash * 4)), 0, 100),
      detailFa: 'از سهم نقد. سقف این جزء وقتی نقد به ۲۵ درصد برسد پر می‌شود.',
    },
    {
      code: 'inflation',
      labelFa: 'پوشش تورمی در سبد',
      score: clamp(Math.round(Math.min(100, (weights.gold + weights.usd) * 3)), 0, 100),
      detailFa: 'سهم طلا و دلار است، نه پیش‌بینی تورم.',
    },
  ];
  if (riskScore != null) {
    parts.push({
      code: 'risk',
      labelFa: 'ریسک',
      score: clamp(Math.round((10 - riskScore) * 10), 0, 100),
      detailFa: 'برعکس امتیاز ریسک همین صفحه.',
    });
  }
  const score = Math.round(parts.reduce((s, p) => s + p.score, 0) / parts.length);
  return { score, parts };
}

export function scenarioImpact(
  weights: Record<ClassKey, number>,
  shocks: Partial<Record<ClassKey, number>>,
) {
  const total = CLASS_KEYS.reduce((s, k) => s + (weights[k] || 0), 0);
  if (total <= 0) {
    return { enough: false, impactPct: null as number | null, lines: [] as Array<{ asset: ClassKey; labelFa: string; shockPct: number; contributionPct: number }>, noteFa: 'داده برای برآورد سناریو کافی نیست.' };
  }
  const lines = CLASS_KEYS.filter((k) => shocks[k] != null && Number.isFinite(Number(shocks[k]))).map((asset) => {
    const shockPct = clamp(Number(shocks[asset]), -80, 200);
    const contributionPct = round2((weights[asset] / 100) * shockPct);
    return { asset, labelFa: CLASS_LABEL_FA[asset], shockPct, contributionPct };
  });
  if (!lines.length) {
    return { enough: false, impactPct: null, lines, noteFa: 'فرض سناریو وارد نشده است.' };
  }
  const impactPct = round2(lines.reduce((s, l) => s + l.contributionPct, 0));
  return {
    enough: true,
    impactPct,
    lines,
    noteFa: METHODOLOGY_FA.scenario,
  };
}

export function buildAlerts(input: {
  regime: RegimeCode;
  enoughRegime: boolean;
  weights: Record<ClassKey, number>;
  lines: Array<{ asset: ClassKey; diffPct: number }>;
}) {
  const alerts: Array<{ code: string; titleFa: string; bodyFa: string }> = [];
  if (input.enoughRegime && input.regime !== 'NEUTRAL') {
    alerts.push({
      code: 'regime',
      titleFa: 'رژیم بازار',
      bodyFa: `رژیم فعلی ${REGIME_LABEL_FA[input.regime]} است.`,
    });
  }
  const top = Math.max(0, ...CLASS_KEYS.map((k) => input.weights[k] || 0));
  if (top >= 40) {
    alerts.push({
      code: 'concentration',
      titleFa: 'تمرکز بالا',
      bodyFa: `یک کلاس ${round1(top).toLocaleString('fa-IR')} درصد سبد است.`,
    });
  }
  const equity = input.lines.find((l) => l.asset === 'equity');
  if (equity && Math.abs(equity.diffPct) >= 10) {
    alerts.push({
      code: 'gap',
      titleFa: 'فاصله از وزن هدف',
      bodyFa: 'سهم سهام با وزن هدف بیش از ۱۰ واحد فرق دارد.',
    });
  }
  return alerts.slice(0, 4);
}

export function fundShift(
  periods: Array<{ label: string; weights: Partial<Record<ClassKey, number>> }>,
) {
  const usable = periods.filter((p) => Object.values(p.weights).some((n) => (n ?? 0) > 0));
  if (usable.length < 2) {
    return {
      enough: false,
      noteFa: 'برای مشاهدهٔ رفتار تاریخی مدیر، حداقل دو دوره با وزن دارایی لازم است.',
      changes: [] as Array<{ asset: ClassKey; labelFa: string; fromPct: number; toPct: number }>,
    };
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const changes = CLASS_KEYS.map((asset) => ({
    asset,
    labelFa: CLASS_LABEL_FA[asset],
    fromPct: round1(first.weights[asset] ?? 0),
    toPct: round1(last.weights[asset] ?? 0),
  })).filter((c) => c.fromPct > 0 || c.toPct > 0);
  return {
    enough: true,
    noteFa: `تغییر وزن از «${first.label}» تا «${last.label}» در گزارش‌های موجود دیده شده است. این مشاهده علت رفتار آینده را ثابت نمی‌کند.`,
    changes,
  };
}

export function pctChange(older: number | null | undefined, newer: number | null | undefined): number | null {
  if (older == null || newer == null || !Number.isFinite(older) || !Number.isFinite(newer) || older === 0) return null;
  return round2(((newer - older) / older) * 100);
}

function renormalize(raw: Record<ClassKey, number>): Record<ClassKey, number> {
  const clamped = {} as Record<ClassKey, number>;
  for (const k of CLASS_KEYS) clamped[k] = Math.max(0, Math.min(75, raw[k]));
  const sum = CLASS_KEYS.reduce((s, k) => s + clamped[k], 0) || 1;
  const out = {} as Record<ClassKey, number>;
  let acc = 0;
  CLASS_KEYS.forEach((k, i) => {
    if (i === CLASS_KEYS.length - 1) out[k] = round1(Math.max(0, 100 - acc));
    else {
      out[k] = round1((clamped[k] / sum) * 100);
      acc = round1(acc + out[k]);
    }
  });
  return out;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
