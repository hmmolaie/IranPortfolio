'use client';

import { useMemo, useState } from 'react';
import { formatNum } from '@/lib/api';

export type CalculatorInitial = {
  symbol?: string | null;
  underlying?: string | null;
  side?: 'CALL' | 'PUT' | null;
  strike?: number | string | null;
  premium?: number | string | null;
  spot?: number | string | null;
  size?: number | string | null;
};

const str = (v: number | string | null | undefined, fallback = '') =>
  v == null || v === '' ? fallback : String(v);

type Side = 'CALL' | 'PUT';
type Strategy = 'long' | 'protective_put' | 'covered_call';

const STRATEGY_FA: Record<Strategy, { label: string; help: string; side: Side | null }> = {
  long: {
    label: 'خرید اختیار',
    help: 'فقط خرید همین اختیار. بیشترین زیان همان قیمت پرداختی اختیار است.',
    side: null,
  },
  protective_put: {
    label: 'پوشش با اختیار فروش',
    help: 'سهم را دارید و اختیار فروش می‌خرید تا افت زیر قیمت اعمال جبران شود.',
    side: 'PUT',
  },
  covered_call: {
    label: 'فروش اختیار خرید روی سهم موجود',
    help: 'سهم را دارید و اختیار خرید می‌فروشید؛ قیمت اختیار را می‌گیرید ولی سود بالای قیمت اعمال را از دست می‌دهید.',
    side: 'CALL',
  },
};

function parseNum(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(
    raw
      .trim()
      .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
      .replace(/[,،٬\s]/g, ''),
  );
  return Number.isFinite(n) ? n : null;
}

/** سود و زیان هر واحد در سررسید برای قیمت پایهٔ S */
function payoff(strategy: Strategy, side: Side, S: number, K: number, P: number, spot: number) {
  const callValue = Math.max(0, S - K);
  const putValue = Math.max(0, K - S);
  if (strategy === 'long') return (side === 'CALL' ? callValue : putValue) - P;
  if (strategy === 'protective_put') return S - spot + putValue - P;
  return S - spot - callValue + P; // covered call
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input className="input" dir="ltr" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * ماشین‌حساب سود و زیان اختیار در سررسید. در صفحهٔ هر نماد اختیار (embedded) و صفحهٔ جدا استفاده می‌شود.
 */
export function OptionPayoffCalculator({
  initial,
  embedded,
}: {
  initial?: CalculatorInitial;
  /** داخل صفحهٔ نماد: بدون سرتیتر صفحه و پیوند بازگشت */
  embedded?: boolean;
}) {
  const initialSide: Side = initial?.side === 'PUT' ? 'PUT' : 'CALL';
  const [side, setSide] = useState<Side>(initialSide);
  const [strategy, setStrategy] = useState<Strategy>('long');
  const [strike, setStrike] = useState(str(initial?.strike));
  const [premium, setPremium] = useState(str(initial?.premium));
  const [spot, setSpot] = useState(str(initial?.spot));
  const [size, setSize] = useState(str(initial?.size, '1000'));
  const [contracts, setContracts] = useState('1');
  const symbol = initial?.symbol ?? null;
  const underlying = initial?.underlying ?? null;

  const effectiveSide: Side = STRATEGY_FA[strategy].side ?? side;
  const K = parseNum(strike);
  const P = parseNum(premium);
  const S0 = parseNum(spot);
  const unit = (parseNum(size) ?? 1) * Math.max(1, parseNum(contracts) ?? 1);

  const calc = useMemo(() => {
    if (K == null || !(K > 0) || P == null || P < 0 || S0 == null || !(S0 > 0)) return null;
    const lo = Math.max(0, Math.min(S0, K) * 0.6);
    const hi = Math.max(S0, K) * 1.4;
    const n = 80;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const S = lo + ((hi - lo) * i) / n;
      return { S, pnl: payoff(strategy, effectiveSide, S, K, P, S0) };
    });
    const pnls = pts.map((p) => p.pnl);
    const breakeven =
      strategy === 'long'
        ? effectiveSide === 'CALL'
          ? K + P
          : K - P
        : strategy === 'protective_put'
          ? S0 + P
          : S0 - P;
    const maxLoss =
      strategy === 'long' ? -P : strategy === 'protective_put' ? K - S0 - P : null; // covered call: تا صفر شدن سهم
    const maxProfit =
      strategy === 'covered_call' ? K - S0 + P : strategy === 'long' && effectiveSide === 'PUT' ? K - P : null;
    return { pts, minPnl: Math.min(...pnls), maxPnl: Math.max(...pnls), lo, hi, breakeven, maxLoss, maxProfit };
  }, [K, P, S0, strategy, effectiveSide]);

  const W = 640;
  const H = 260;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const xAt = (S: number) => (calc ? pad.l + ((S - calc.lo) / (calc.hi - calc.lo)) * (W - pad.l - pad.r) : 0);
  const yAt = (v: number) => {
    if (!calc) return 0;
    const span = Math.max(1, calc.maxPnl - calc.minPnl);
    return pad.t + (1 - (v - calc.minPnl) / span) * (H - pad.t - pad.b);
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      <div>
        {embedded ? (
          <h2 className="text-lg font-semibold">ماشین‌حساب سود و زیان</h2>
        ) : (
          <h1 className="text-3xl font-bold">ماشین‌حساب استراتژی اختیار</h1>
        )}
        <p className="mt-2 text-sm text-navy-800/65">
          سود و زیان در روز سررسید برای قیمت‌های مختلف دارایی پایه{symbol ? ` · ${symbol}` : ''}
          {underlying ? ` روی ${underlying}` : ''}. کارمزد و مالیات در این محاسبه نیست و نتیجه توصیهٔ معامله نیست.
        </p>
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="استراتژی">
          {(Object.keys(STRATEGY_FA) as Strategy[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={strategy === k}
              className={`rounded-full px-3 py-1.5 text-sm ${strategy === k ? 'bg-navy-900 text-white' : 'bg-navy-50 text-navy-800'}`}
              onClick={() => setStrategy(k)}
            >
              {STRATEGY_FA[k].label}
            </button>
          ))}
        </div>
        <p className="text-sm leading-7 text-navy-800/70">{STRATEGY_FA[strategy].help}</p>
        {strategy === 'long' && (
          <div className="flex gap-2">
            {(['CALL', 'PUT'] as Side[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${side === s ? 'border-navy-900 bg-navy-50' : 'border-navy-900/15'}`}
                onClick={() => setSide(s)}
              >
                {s === 'CALL' ? 'اختیار خرید' : 'اختیار فروش'}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="قیمت اعمال" value={strike} onChange={setStrike} />
          <Field label="قیمت اختیار" value={premium} onChange={setPremium} />
          <Field label="قیمت فعلی پایه" value={spot} onChange={setSpot} />
          <Field label="اندازهٔ قرارداد" value={size} onChange={setSize} />
          <Field label="تعداد قرارداد" value={contracts} onChange={setContracts} />
        </div>
      </section>

      {!calc ? (
        <p className="text-sm text-navy-800/60">قیمت اعمال، قیمت اختیار و قیمت فعلی پایه را وارد کنید.</p>
      ) : (
        <section className="card space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-navy-800/55">نقطهٔ سربه‌سر</div>
              <div className="mt-1 text-lg font-semibold">{formatNum(Math.round(calc.breakeven))}</div>
            </div>
            <div>
              <div className="text-xs text-navy-800/55">بیشترین زیان</div>
              <div className="mt-1 text-lg font-semibold text-red-700">
                {calc.maxLoss == null ? 'تا افت کامل سهم' : formatNum(Math.round(calc.maxLoss * unit))}
              </div>
            </div>
            <div>
              <div className="text-xs text-navy-800/55">بیشترین سود</div>
              <div className="mt-1 text-lg font-semibold text-emerald-700">
                {calc.maxProfit == null ? 'نامحدود' : formatNum(Math.round(calc.maxProfit * unit))}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto" dir="ltr">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[22rem]" role="img" aria-label="نمودار سود و زیان">
              <line x1={pad.l} x2={W - pad.r} y1={yAt(0)} y2={yAt(0)} stroke="rgba(11,31,58,0.35)" strokeDasharray="4 4" />
              <line x1={xAt(S0!)} x2={xAt(S0!)} y1={pad.t} y2={H - pad.b} stroke="rgba(168,137,62,0.6)" />
              <path
                d={calc.pts.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.S).toFixed(1)},${yAt(p.pnl).toFixed(1)}`).join(' ')}
                fill="none"
                stroke="#0b1f3a"
                strokeWidth={2}
              />
              {[calc.lo, (calc.lo + calc.hi) / 2, calc.hi].map((S) => (
                <text key={S} x={xAt(S)} y={H - 8} textAnchor="middle" fontSize={10} className="fill-navy-800/60">
                  {Math.round(S).toLocaleString('fa-IR')}
                </text>
              ))}
              {[calc.minPnl, 0, calc.maxPnl].map((v) => (
                <text key={v} x={pad.l - 6} y={yAt(v) + 3} textAnchor="end" fontSize={10} className="fill-navy-800/60">
                  {Math.round(v * unit).toLocaleString('fa-IR')}
                </text>
              ))}
            </svg>
          </div>
          <p className="text-xs text-navy-800/55">
            محور افقی قیمت پایه در سررسید و محور عمودی سود یا زیان کل (ریال) برای {formatNum(unit)} واحد است. خط طلایی
            قیمت فعلی پایه است.
          </p>
        </section>
      )}
    </div>
  );
}
