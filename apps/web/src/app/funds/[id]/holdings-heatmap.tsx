'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { api } from '@/lib/api';

type Period = {
  reportId: string;
  reportMonth: string;
  reportYear?: number | null;
  reportMonthNum?: number | null;
  hasData: boolean;
};

type SymbolRow = {
  symbol: string;
  nameFa: string;
  assetKind: string;
  /** null یعنی گزارش آن دوره دارایی استخراج‌شده ندارد */
  weights: (number | null)[];
};

type Timeline = { periods: Period[]; symbols: SymbolRow[] };

const MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const KIND_FA: Record<string, string> = {
  STOCK: 'سهام',
  BOND: 'اوراق',
  GOLD: 'طلا',
  CASH: 'نقد',
  DEPOSIT: 'سپرده',
  FUND: 'صندوق',
  OTHER: 'سایر',
};

const TOP_ROWS = 20;
/** رنگ پایهٔ نقشه (navy-900)؛ شدت با وزن بیشتر می‌شود */
const INK = '11, 31, 58';

const pct = (n: number) => `${n.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪`;

function monthName(p: Period) {
  return p.reportMonthNum ? MONTHS_FA[p.reportMonthNum - 1] ?? String(p.reportMonthNum) : p.reportMonth;
}

function yearShort(p: Period) {
  return p.reportYear ? String(p.reportYear).slice(-2).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : '';
}

function periodFull(p: Period) {
  return p.reportYear ? `${monthName(p)} ${p.reportYear.toLocaleString('fa-IR', { useGrouping: false })}` : monthName(p);
}

/** آخرین دو دوره‌ای که داده دارند */
function lastChange(weights: (number | null)[]): number | null {
  const known = weights.map((w, i) => ({ w, i })).filter((x) => x.w != null) as { w: number; i: number }[];
  if (known.length < 2) return null;
  return Math.round((known[known.length - 1].w - known[known.length - 2].w) * 10) / 10;
}

function latestKnown(weights: (number | null)[]): number {
  for (let i = weights.length - 1; i >= 0; i--) if (weights[i] != null) return weights[i] as number;
  return 0;
}

const SPARK_W = 72;
const SPARK_H = 24;
const SPARK_PAD = 3;

/**
 * نمودار روند کوچک وزن نماد در ماه‌ها. مثل ستون‌های جدول، زمان از راست به چپ جلو می‌رود
 * (ماه اول سمت راست، آخرین ماه سمت چپ). ماه بدون داده جا می‌ماند و خط از رویش رد می‌شود.
 * رنگ با جهت کلی از اولین تا آخرین ماهِ دارای داده است.
 */
function WeightSparkline({ weights, label }: { weights: (number | null)[]; label: string }) {
  const known = weights
    .map((w, i) => ({ w, i }))
    .filter((x): x is { w: number; i: number } => x.w != null);
  if (known.length < 2) {
    return <span className="text-navy-800/30">—</span>;
  }
  const n = weights.length;
  const vals = known.map((k) => k.w);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => SPARK_W - SPARK_PAD - (i / Math.max(1, n - 1)) * (SPARK_W - 2 * SPARK_PAD);
  const y = (w: number) =>
    max === min ? SPARK_H / 2 : SPARK_PAD + (1 - (w - min) / span) * (SPARK_H - 2 * SPARK_PAD);
  const first = known[0].w;
  const last = known[known.length - 1];
  const delta = last.w - first;
  const color = Math.abs(delta) < 0.05 ? '#a8893e' : delta > 0 ? '#047857' : '#b91c1c';
  const path = known.map((k, j) => `${j === 0 ? 'M' : 'L'}${x(k.i).toFixed(1)},${y(k.w).toFixed(1)}`).join(' ');
  const trendFa = Math.abs(delta) < 0.05 ? 'تقریباً ثابت' : delta > 0 ? 'افزایشی' : 'کاهشی';
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label={`روند ${label}: ${trendFa}`}
      className="block"
    >
      <title>{`روند ماهانه: ${trendFa} (${pct(first)} تا ${pct(last.w)})`}</title>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.w)} r={2.2} fill={color} />
    </svg>
  );
}

/**
 * نقشهٔ حرارتی وزن نمادها در سبد صندوق: هر سطر یک نماد، هر ستون یک ماه.
 * پررنگ‌تر یعنی سهم بیشتر از کل دارایی صندوق؛ عدد هر خانه همان درصد است.
 */
export function HoldingsHeatmap({ fundId }: { fundId: string }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'STOCK' | 'ALL'>('STOCK');
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    setData(null);
    setError('');
    api<Timeline>(`/funds/definitions/${fundId}/weights-timeline`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [fundId]);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.symbols
      .filter((s) => kind === 'ALL' || s.assetKind === 'STOCK')
      .filter((s) => s.weights.some((w) => (w ?? 0) > 0))
      .sort((a, b) => {
        const d = latestKnown(b.weights) - latestKnown(a.weights);
        if (d !== 0) return d;
        return Math.max(...b.weights.map((w) => w ?? 0)) - Math.max(...a.weights.map((w) => w ?? 0));
      });
  }, [data, kind]);

  const visible = showAll ? rows : rows.slice(0, TOP_ROWS);
  const maxWeight = useMemo(
    () => Math.max(1, ...rows.flatMap((r) => r.weights.map((w) => w ?? 0))),
    [rows],
  );

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="py-6 text-sm text-navy-800/55">در حال بارگذاری...</p>;
  if (data.periods.length === 0 || data.symbols.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-navy-800/55">
        هنوز گزارش آنالیزشده‌ای با فهرست دارایی برای این صندوق نیست.
      </p>
    );
  }

  const periods = data.periods;
  const hovered = hover ? visible[hover.row] : null;
  const hoverText = (() => {
    if (!hover || !hovered) return null;
    const w = hovered.weights[hover.col];
    const p = periods[hover.col];
    if (w == null) return `${hovered.nameFa} — ${periodFull(p)}: دارایی‌های این گزارش استخراج نشده`;
    let prevIdx = hover.col - 1;
    while (prevIdx >= 0 && hovered.weights[prevIdx] == null) prevIdx--;
    const prev = prevIdx >= 0 ? hovered.weights[prevIdx] : null;
    const delta = prev != null ? Math.round((w - prev) * 10) / 10 : null;
    const deltaText =
      delta == null
        ? ''
        : delta === 0
          ? ` (بدون تغییر نسبت به ${monthName(periods[prevIdx])})`
          : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('fa-IR')} واحد نسبت به ${monthName(periods[prevIdx])})`;
    return `${hovered.nameFa} — ${periodFull(p)}: ${pct(w)} از کل دارایی صندوق${deltaText}`;
  })();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="radiogroup" aria-label="نوع دارایی">
          {(
            [
              ['STOCK', 'فقط سهام'],
              ['ALL', 'همهٔ دارایی‌ها'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={clsx(
                'rounded-full px-3 py-1 text-xs',
                kind === k ? 'bg-navy-900 text-white' : 'bg-navy-50 text-navy-800',
              )}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* راهنمای شدت رنگ */}
        <div className="flex items-center gap-2 text-xs text-navy-800/60">
          <span>۰٪</span>
          <span
            className="h-2.5 w-28 rounded-full"
            style={{ background: `linear-gradient(to left, rgba(${INK},0.9), rgba(${INK},0.06))` }}
            aria-hidden
          />
          <span>{pct(maxWeight)}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-sm text-navy-800/55">در این گزارش‌ها سهمی با وزن ثبت‌شده پیدا نشد.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate text-xs" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="sticky right-0 z-10 bg-white px-2 py-1 text-start font-medium text-navy-800/60">
                  نماد
                </th>
                <th className="px-1 py-1 text-center font-medium text-navy-800/60">روند</th>
                {periods.map((p) => (
                  <th
                    key={p.reportId}
                    className="min-w-[3.5rem] px-1 py-1 text-center font-medium leading-4 text-navy-800/60"
                    title={p.hasData ? periodFull(p) : `${periodFull(p)} — دارایی‌ها استخراج نشده`}
                  >
                    {monthName(p)}
                    <br />
                    <span className="text-[10px] text-navy-800/40">{yearShort(p)}</span>
                  </th>
                ))}
                <th className="px-2 py-1 text-center font-medium text-navy-800/60">تغییر آخر</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => {
                const change = lastChange(row.weights);
                return (
                  <tr key={row.symbol}>
                    <th
                      scope="row"
                      className="sticky right-0 z-10 max-w-[10rem] truncate bg-white px-2 py-1 text-start font-medium text-navy-900"
                      title={`${row.nameFa} · ${KIND_FA[row.assetKind] ?? row.assetKind}`}
                    >
                      {row.nameFa}
                    </th>
                    <td className="px-1 py-1 align-middle">
                      <WeightSparkline weights={row.weights} label={row.nameFa} />
                    </td>
                    {row.weights.map((w, ci) => {
                      const alpha = w == null || w <= 0 ? 0 : 0.08 + 0.82 * Math.min(1, w / maxWeight);
                      const active = hover?.row === ri && hover?.col === ci;
                      return (
                        <td
                          key={periods[ci].reportId}
                          tabIndex={0}
                          onMouseEnter={() => setHover({ row: ri, col: ci })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover({ row: ri, col: ci })}
                          onBlur={() => setHover(null)}
                          className={clsx(
                            'h-8 rounded px-1 text-center tabular-nums outline-none transition',
                            w == null && 'text-navy-800/30',
                            active && 'ring-2 ring-gold-500',
                          )}
                          style={{
                            backgroundColor:
                              w == null
                                ? 'transparent'
                                : alpha === 0
                                  ? 'rgba(11,31,58,0.03)'
                                  : `rgba(${INK},${alpha.toFixed(3)})`,
                            color: alpha > 0.5 ? '#fff' : undefined,
                            backgroundImage:
                              w == null
                                ? 'repeating-linear-gradient(45deg, rgba(11,31,58,0.06) 0 2px, transparent 2px 6px)'
                                : undefined,
                          }}
                        >
                          {w == null ? '—' : w > 0 ? pct(w) : <span className="text-navy-800/30">۰</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-center tabular-nums whitespace-nowrap">
                      {change == null || change === 0 ? (
                        <span className="text-navy-800/40">—</span>
                      ) : (
                        <span className={change > 0 ? 'text-emerald-700' : 'text-red-700'}>
                          {change > 0 ? '▲' : '▼'} {Math.abs(change).toLocaleString('fa-IR')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="min-h-[1.25rem] text-xs text-navy-800/70" aria-live="polite">
        {hoverText ?? 'روی هر خانه بروید تا درصد و تغییر نسبت به ماه قبل را ببینید.'}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-navy-800/55">
        <span>
          درصد از کل دارایی صندوق در هر گزارش. «۰» یعنی نماد در آن ماه در سبد نبوده؛ «—» یعنی دارایی‌های آن گزارش
          استخراج نشده. «تغییر آخر» به واحد درصد است. نمودار «روند» مثل ستون‌ها از ماه اول (راست) تا آخرین ماه
          (چپ) است؛ سبز افزایش، قرمز کاهش.
        </span>
        {rows.length > TOP_ROWS && (
          <button type="button" className="text-navy-900 underline" onClick={() => setShowAll((v) => !v)}>
            {showAll
              ? `فقط ${TOP_ROWS.toLocaleString('fa-IR')} نماد بزرگ‌تر`
              : `نمایش همهٔ ${rows.length.toLocaleString('fa-IR')} نماد`}
          </button>
        )}
      </div>
    </div>
  );
}
