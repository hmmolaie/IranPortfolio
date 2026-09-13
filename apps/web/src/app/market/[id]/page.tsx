'use client';

import Link from 'next/link';
import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ASSET_TYPE_LABELS_FA, AssetType } from '@sabadyar/shared';
import { api, formatNum, getToken } from '@/lib/api';
import clsx from 'clsx';

type Bar = {
  tradeDate: string;
  lastPrice?: number | null;
  closePrice?: number | null;
  eps?: number | null;
  pe?: number | null;
  volume?: number | null;
};

type Instrument = {
  id: string;
  symbol: string;
  nameFa: string;
  assetType: string;
  insCode?: string | null;
  last: Bar | null;
};

type RangeKey = '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'Max';

const RANGES: { key: RangeKey; label: string; days?: number }[] = [
  { key: '5D', label: '۵روز', days: 5 },
  { key: '1M', label: '۱ماه', days: 30 },
  { key: '6M', label: '۶ماه', days: 180 },
  { key: 'YTD', label: 'از اول سال' },
  { key: '1Y', label: '۱سال', days: 365 },
  { key: '5Y', label: '۵سال', days: 365 * 5 },
  { key: 'Max', label: 'همه' },
];

function priceOf(b: Bar) {
  return b.closePrice ?? b.lastPrice ?? 0;
}

function formatRialPrice(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatPct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function filterBars(bars: Bar[], range: RangeKey): Bar[] {
  if (!bars.length) return [];
  if (range === 'Max') return bars;
  const last = new Date(bars[bars.length - 1].tradeDate);
  if (range === 'YTD') {
    const start = new Date(last.getFullYear(), 0, 1);
    return bars.filter((b) => new Date(b.tradeDate) >= start);
  }
  const days = RANGES.find((r) => r.key === range)?.days ?? 30;
  const from = new Date(last);
  from.setDate(from.getDate() - days);
  return bars.filter((b) => new Date(b.tradeDate) >= from);
}

function InteractiveChart({
  bars,
  prevClose,
}: {
  bars: Bar[];
  prevClose: number | null;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const prices = bars.map(priceOf).filter((p) => p > 0);
  if (prices.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-navy-800/45">دادهٔ تاریخی کافی برای نمودار نیست.</p>
    );
  }

  const w = 720;
  const h = 220;
  const padL = 52;
  const padR = 88;
  const padT = 16;
  const padB = 28;
  const min = Math.min(...prices, prevClose && prevClose > 0 ? prevClose : prices[0]);
  const max = Math.max(...prices, prevClose && prevClose > 0 ? prevClose : prices[0]);
  const range = max - min || 1;

  const pts = prices.map((p, i) => {
    const x = padL + (i / (prices.length - 1)) * (w - padL - padR);
    const y = padT + (1 - (p - min) / range) * (h - padT - padB);
    return { x, y, p, i };
  });

  const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${pts[0].x},${h - padB} ${line} ${pts[pts.length - 1].x},${h - padB}`;

  const first = prices[0];
  const up = prices[prices.length - 1] >= first;
  const stroke = up ? '#15803d' : '#b91c1c';
  const fillId = up ? 'gUp' : 'gDown';

  const yTicks = [max, (max + min) / 2, min];
  const xLabelIdx = [0, Math.floor(prices.length / 2), prices.length - 1];

  const prevY =
    prevClose && prevClose > 0
      ? padT + (1 - (prevClose - min) / range) * (h - padT - padB)
      : null;

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

  const hi = hover != null ? pts[hover] : null;
  const hiBar = hover != null ? bars[hover] : null;
  const hiPct = hi && first ? ((hi.p - first) / first) * 100 : 0;

  return (
    <div className="relative bg-transparent">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="mx-auto max-h-[14rem] w-full max-w-3xl touch-pan-y bg-transparent"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="نمودار قیمت"
      >
        <defs>
          <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#15803d" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#15803d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#b91c1c" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#b91c1c" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => {
          const y = padT + (1 - (t - min) / range) * (h - padT - padB);
          return (
            <g key={i}>
              <line
                x1={padL}
                y1={y}
                x2={w - padR}
                y2={y}
                stroke="rgba(11,31,58,0.08)"
                strokeWidth={1}
              />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fill="rgba(11,31,58,0.4)" fontSize={10}>
                {formatRialPrice(t)}
              </text>
            </g>
          );
        })}

        {prevY != null && (
          <g>
            <line
              x1={padL}
              y1={prevY}
              x2={w - padR}
              y2={prevY}
              stroke="rgba(11,31,58,0.28)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={w - padR + 6} y={prevY + 3.5} fill="rgba(11,31,58,0.45)" fontSize={10}>
              پایانی قبل
            </text>
          </g>
        )}

        <polygon points={area} fill={`url(#${fillId})`} />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={line}
        />

        {xLabelIdx.map((i) => (
          <text
            key={i}
            x={pts[i].x}
            y={h - 8}
            textAnchor="middle"
            fill="rgba(11,31,58,0.4)"
            fontSize={10}
          >
            {new Date(bars[i].tradeDate).toLocaleDateString('fa-IR')}
          </text>
        ))}

        {hi && hiBar && (
          <g>
            <line
              x1={hi.x}
              y1={padT}
              x2={hi.x}
              y2={h - padB}
              stroke="rgba(11,31,58,0.25)"
              strokeDasharray="3 3"
            />
            <circle cx={hi.x} cy={hi.y} r={4} fill={stroke} stroke="#fffef8" strokeWidth={2} />
            <foreignObject
              x={Math.min(Math.max(hi.x - 80, padL), w - padR - 160)}
              y={Math.max(hi.y - 42, 2)}
              width={160}
              height={36}
            >
              <div className="rounded-lg border border-navy-900/10 bg-white/90 px-2 py-1 text-center text-[11px] text-navy-900 shadow-sm backdrop-blur-sm">
                <span className="font-medium">{formatRialPrice(hi.p)}</span>
                <span className={clsx('ms-1.5', hiPct >= 0 ? 'text-emerald-700' : 'text-red-700')}>
                  {formatPct(hiPct)}
                </span>
                <span className="ms-1.5 text-navy-800/45">
                  {new Date(hiBar.tradeDate).toLocaleDateString('fa-IR')}
                </span>
              </div>
            </foreignObject>
          </g>
        )}
      </svg>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-navy-900/5 py-2.5">
      <span className="text-sm text-navy-800/50">{label}</span>
      <span className="text-sm font-medium text-navy-900">{value}</span>
    </div>
  );
}

export default function MarketInstrumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inst, setInst] = useState<Instrument | null>(null);
  const [history, setHistory] = useState<Bar[]>([]);
  const [range, setRange] = useState<RangeKey>('1M');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    Promise.all([
      api<Instrument>(`/market/instruments/${id}`),
      api<Bar[]>(`/market/instruments/${id}/history?limit=1500`),
    ])
      .then(([i, h]) => {
        setInst(i);
        setHistory(h);
      })
      .catch(() => router.replace('/market'));
  }, [id, router]);

  const visible = useMemo(() => filterBars(history, range), [history, range]);

  const stats = useMemo(() => {
    const prices = visible.map(priceOf).filter((p) => p > 0);
    const allYear = filterBars(history, '1Y').map(priceOf).filter((p) => p > 0);
    const last = inst?.last;
    const current = last?.lastPrice ?? last?.closePrice ?? prices[prices.length - 1] ?? null;
    const prev =
      history.length >= 2
        ? priceOf(history[history.length - 2])
        : last?.closePrice ?? null;
    const changePct =
      current != null && prev && prev > 0 ? ((current - prev) / prev) * 100 : null;
    return {
      current,
      prev,
      changePct,
      open: prices[0] ?? null,
      high: prices.length ? Math.max(...prices) : null,
      low: prices.length ? Math.min(...prices) : null,
      pe: last?.pe ?? null,
      eps: last?.eps ?? null,
      volume: last?.volume ?? null,
      high52: allYear.length ? Math.max(...allYear) : null,
      low52: allYear.length ? Math.min(...allYear) : null,
      asOf: last?.tradeDate ?? history[history.length - 1]?.tradeDate ?? null,
    };
  }, [visible, history, inst]);

  if (!inst) {
    return <p className="text-navy-800/60">در حال بارگذاری...</p>;
  }

  const up = (stats.changePct ?? 0) >= 0;
  const rangeLabel =
    visible.length >= 2
      ? `${new Date(visible[0].tradeDate).toLocaleDateString('fa-IR')} – ${new Date(
          visible[visible.length - 1].tradeDate,
        ).toLocaleDateString('fa-IR')}`
      : '';

  return (
    <div className="space-y-6 bg-transparent">
      <Link href="/market" className="text-sm text-navy-800/50 transition hover:text-navy-900">
        ← بازگشت به بازار سهام تهران
      </Link>

      <div>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-bold text-navy-900">{inst.symbol}</h1>
            <p className="text-base leading-7 text-navy-800/60">{inst.nameFa}</p>
          </div>
          <span className="mt-1 shrink-0 rounded-md bg-navy-900/5 px-2 py-0.5 text-xs text-navy-800/60">
            {ASSET_TYPE_LABELS_FA[inst.assetType as AssetType] ?? inst.assetType}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
            {formatRialPrice(stats.current)}
            <span className="ms-2 text-base font-normal text-navy-800/40">ریال</span>
          </div>
          {stats.changePct != null && (
            <span
              className={clsx(
                'rounded-full px-3 py-1 text-sm font-medium',
                up ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
              )}
            >
              {up ? '↑' : '↓'} {formatPct(Math.abs(stats.changePct))} امروز
            </span>
          )}
        </div>
        {stats.asOf && (
          <p className="mt-2 text-xs text-navy-800/45">
            به‌روزرسانی:{' '}
            {new Date(stats.asOf).toLocaleString('fa-IR', {
              dateStyle: 'medium',
              timeZone: 'Asia/Tehran',
            })}
          </p>
        )}
      </div>

      <div className="bg-transparent">
        <InteractiveChart bars={visible} prevClose={stats.prev} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-navy-900/10 pb-3">
        {rangeLabel && <span className="me-2 text-xs text-navy-800/40">{rangeLabel}</span>}
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              range === r.key
                ? 'bg-navy-900 text-white'
                : 'text-navy-800/55 hover:bg-navy-900/5 hover:text-navy-900',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid gap-x-10 gap-y-1 sm:grid-cols-3">
        <div>
          <StatRow label="باز" value={formatRialPrice(stats.open)} />
          <StatRow label="بیشینه" value={formatRialPrice(stats.high)} />
          <StatRow label="کمینه" value={formatRialPrice(stats.low)} />
        </div>
        <div>
          <StatRow label="حجم" value={formatNum(stats.volume)} />
          <StatRow label="P/E" value={formatNum(stats.pe)} />
          <StatRow label="EPS" value={formatNum(stats.eps)} />
        </div>
        <div>
          <StatRow label="بیشینه ۵۲ هفته" value={formatRialPrice(stats.high52)} />
          <StatRow label="کمینه ۵۲ هفته" value={formatRialPrice(stats.low52)} />
          <StatRow label="پایانی قبل" value={formatRialPrice(stats.prev)} />
        </div>
      </div>

      <section>
        <h2 className="text-base font-semibold text-navy-900">خلاصه معاملات بازه</h2>
        <ul className="mt-3 list-disc space-y-2 pe-5 text-sm text-navy-800/70">
          <li>
            دامنه قیمت: {formatRialPrice(stats.low)} – {formatRialPrice(stats.high)} ریال
          </li>
          {stats.changePct != null && (
            <li>تغییر نسبت به روز قبل: {formatPct(stats.changePct)}</li>
          )}
          <li>تعداد روزهای نمودار: {visible.length.toLocaleString('fa-IR')}</li>
        </ul>
      </section>
    </div>
  );
}
