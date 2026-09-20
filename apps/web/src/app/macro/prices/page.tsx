'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import clsx from 'clsx';
import { formatShamsiDate } from '@/lib/shamsi-date';

type SpotRow = {
  id: string;
  dateKey: string;
  asOfDate: string;
  usdIrr?: number | null;
  goldGramRial?: number | null;
};

type SeriesKey = 'usd' | 'gold';
type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'Max';

const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: '1M', label: '۱ماه', days: 30 },
  { key: '3M', label: '۳ماه', days: 90 },
  { key: '6M', label: '۶ماه', days: 180 },
  { key: '1Y', label: '۱سال', days: 365 },
  { key: 'Max', label: 'همه' },
];

function formatRial(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatPct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function filterRows(rows: SpotRow[], range: RangeKey): SpotRow[] {
  if (!rows.length) return [];
  if (range === 'Max') return rows;
  const days = RANGES.find((r) => r.key === range)?.days ?? 90;
  const last = rows[rows.length - 1];
  const lastDate = new Date(last.asOfDate || last.dateKey);
  const from = new Date(lastDate);
  from.setDate(from.getDate() - days);
  return rows.filter((r) => new Date(r.asOfDate || r.dateKey) >= from);
}

function DualSeriesChart({
  rows,
  series,
}: {
  rows: SpotRow[];
  series: SeriesKey;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const prices = rows
    .map((r) => (series === 'usd' ? r.usdIrr : r.goldGramRial) ?? 0)
    .filter((p) => p > 0);

  if (prices.length < 2) {
    return (
      <p className="py-16 text-center text-sm text-white/45">دادهٔ تاریخی کافی برای نمودار نیست.</p>
    );
  }

  const w = 900;
  const h = 320;
  const padL = 72;
  const padR = 28;
  const padT = 28;
  const padB = 36;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const pts = prices.map((p, i) => {
    const x = padL + (i / (prices.length - 1)) * (w - padL - padR);
    const y = padT + (1 - (p - min) / range) * (h - padT - padB);
    return { x, y, p, i };
  });

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${path} L ${pts[pts.length - 1].x} ${h - padB} L ${pts[0].x} ${h - padB} Z`;
  const up = prices[prices.length - 1] >= prices[0];
  const stroke = up ? '#34d399' : '#f87171';
  const fill = up ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';
  const hi = hover != null ? pts[hover] : pts[pts.length - 1];
  const hiRow = rows[hi.i];

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    let best = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * range);

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-1 text-white">
        <div>
          <div className="text-sm text-white/55">
            {series === 'usd' ? 'دلار آزاد' : 'طلا (گرم)'} — {formatShamsiDate(hiRow?.dateKey)}
          </div>
          <div className="mt-1 text-3xl font-semibold tracking-tight">{formatRial(hi.p)}</div>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="نمودار قیمت"
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={padT + (1 - (t - min) / range) * (h - padT - padB)}
              x2={w - padR}
              y2={padT + (1 - (t - min) / range) * (h - padT - padB)}
              stroke="rgba(255,255,255,0.08)"
            />
            <text
              x={padL - 10}
              y={padT + (1 - (t - min) / range) * (h - padT - padB) + 4}
              textAnchor="end"
              fill="rgba(255,255,255,0.4)"
              fontSize={11}
            >
              {formatRial(t)}
            </text>
          </g>
        ))}
        <path d={area} fill={fill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth={2.4} strokeLinejoin="round" />
        <circle cx={hi.x} cy={hi.y} r={5} fill={stroke} />
        <line
          x1={hi.x}
          y1={padT}
          x2={hi.x}
          y2={h - padB}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="4 4"
        />
      </svg>
    </div>
  );
}

export default function MacroPricesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SpotRow[]>([]);
  const [series, setSeries] = useState<SeriesKey>('usd');
  const [range, setRange] = useState<RangeKey>('3M');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ role?: string }>('/users/me')
      .then((u) => {
        if (u.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
        return api<SpotRow[]>('/prices/history?days=730');
      })
      .then((data) => {
        if (data) setRows(data);
      })
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const filtered = useMemo(() => filterRows(rows, range), [rows, range]);

  const latest = rows[rows.length - 1];
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const lastVal = series === 'usd' ? last?.usdIrr : last?.goldGramRial;
  const firstVal = series === 'usd' ? first?.usdIrr : first?.goldGramRial;
  const changePct =
    firstVal && lastVal && firstVal > 0 ? ((lastVal - firstVal) / firstVal) * 100 : null;

  return (
    <div className="min-h-[70vh] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/macro" className="text-sm text-navy-800/55 hover:text-navy-800">
            ← اقتصاد ایران
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-navy-900">روند قیمت دلار و طلا</h1>
          <p className="mt-1 text-sm text-navy-800/60">
            بر اساس قیمت‌های ذخیره‌شده از API لحظه‌ای
          </p>
        </div>
        {latest && (
          <div className="rounded-xl bg-navy-50 px-4 py-3 text-sm text-navy-800/80">
            <div>آخرین روز: {formatShamsiDate(latest.dateKey)}</div>
            <div className="mt-1">دلار: {formatRial(latest.usdIrr)}</div>
            <div>طلا (گرم): {formatRial(latest.goldGramRial)}</div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-2xl bg-[#0f1419] p-4 text-white shadow-lg sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(
              [
                { key: 'usd', label: 'دلار' },
                { key: 'gold', label: 'طلا' },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSeries(s.key)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-sm transition',
                  series === s.key ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={clsx(
                  'rounded-md px-2.5 py-1 text-xs transition',
                  range === r.key ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/80',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {changePct != null && (
          <div
            className={clsx(
              'mb-2 text-sm font-medium',
              changePct >= 0 ? 'text-emerald-300' : 'text-red-300',
            )}
          >
            تغییر بازه: {formatPct(changePct)}
          </div>
        )}

        <DualSeriesChart rows={filtered} series={series} />
      </div>
    </div>
  );
}
