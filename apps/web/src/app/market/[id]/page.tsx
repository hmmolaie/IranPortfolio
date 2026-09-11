'use client';

import Link from 'next/link';
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
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
      <p className="py-16 text-center text-sm text-white/45">دادهٔ تاریخی کافی برای نمودار نیست.</p>
    );
  }

  const w = 900;
  const h = 320;
  const padL = 56;
  const padR = 110;
  const padT = 28;
  const padB = 36;
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
  const stroke = up ? '#34a853' : '#ea4335';
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
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="w-full touch-pan-y"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="نمودار قیمت"
      >
        <defs>
          <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34a853" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#34a853" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ea4335" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ea4335" stopOpacity="0" />
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
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize={11}>
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
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={w - padR + 8} y={prevY + 4} fill="rgba(255,255,255,0.55)" fontSize={11}>
              پایانی قبل {formatRialPrice(prevClose)}
            </text>
          </g>
        )}

        <polygon points={area} fill={`url(#${fillId})`} />
        <polyline fill="none" stroke={stroke} strokeWidth={2.2} points={line} />

        {xLabelIdx.map((i) => (
          <text
            key={i}
            x={pts[i].x}
            y={h - 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.4)"
            fontSize={11}
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
              stroke="rgba(255,255,255,0.35)"
              strokeDasharray="3 3"
            />
            <circle cx={hi.x} cy={hi.y} r={4.5} fill={stroke} stroke="#131314" strokeWidth={2} />
            <foreignObject
              x={Math.min(Math.max(hi.x - 90, padL), w - padR - 180)}
              y={Math.max(hi.y - 48, 4)}
              width={180}
              height={40}
            >
              <div className="rounded-md bg-black/90 px-2.5 py-1.5 text-center text-[11px] text-white shadow-lg">
                <span className="font-medium">{formatRialPrice(hi.p)}</span>
                <span className={clsx('ms-1.5', hiPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {formatPct(hiPct)}
                </span>
                <span className="ms-1.5 text-white/50">
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
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-2.5">
      <span className="text-sm text-white/45">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

export default function MarketInstrumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inst, setInst] = useState<Instrument | null>(null);
  const [history, setHistory] = useState<Bar[]>([]);
  const [range, setRange] = useState<RangeKey>('1M');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [askBusy, setAskBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
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

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setAskBusy(true);
    setAnswer('');
    try {
      const res = await api<{ answer: string }>(`/market/instruments/${id}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      setAnswer(res.answer);
    } catch (err) {
      setAnswer((err as Error).message);
    } finally {
      setAskBusy(false);
    }
  }

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
    <div className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-[#131314] text-white sm:-mx-8">
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-8">
        <Link href="/market" className="text-sm text-white/45 transition hover:text-white/80">
          ← بازگشت به بازار سهام تهران
        </Link>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-lg font-medium text-white/80">
              {inst.symbol}
              <span className="ms-2 text-sm font-normal text-white/45">{inst.nameFa}</span>
            </h1>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">
              {ASSET_TYPE_LABELS_FA[inst.assetType as AssetType] ?? inst.assetType}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="text-4xl font-normal tracking-tight sm:text-5xl">
              {formatRialPrice(stats.current)}
              <span className="ms-2 text-base text-white/40">ریال</span>
            </div>
            {stats.changePct != null && (
              <span
                className={clsx(
                  'rounded-full px-3 py-1 text-sm font-medium',
                  up ? 'bg-[#0d652d] text-[#ceead6]' : 'bg-[#8c1d18] text-[#fce8e6]',
                )}
              >
                {up ? '↑' : '↓'} {formatPct(Math.abs(stats.changePct))} امروز
              </span>
            )}
          </div>
          {stats.asOf && (
            <p className="mt-2 text-xs text-white/40">
              به‌روزرسانی:{' '}
              {new Date(stats.asOf).toLocaleString('fa-IR', {
                dateStyle: 'medium',
                timeZone: 'Asia/Tehran',
              })}{' '}
              · خروجی سایت مشاوره سرمایه‌گذاری رسمی نیست
            </p>
          )}
        </div>

        <div className="mt-6">
          <InteractiveChart bars={visible} prevClose={stats.prev} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
          {rangeLabel && <span className="me-2 text-xs text-white/40">{rangeLabel}</span>}
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition',
                range === r.key
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-x-10 gap-y-1 sm:grid-cols-3">
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

        <section className="mt-10">
          <h2 className="text-base font-medium">خلاصه معاملات بازه</h2>
          <ul className="mt-3 list-disc space-y-2 pe-5 text-sm text-white/70">
            <li>
              دامنه قیمت: {formatRialPrice(stats.low)} – {formatRialPrice(stats.high)} ریال
            </li>
            {stats.changePct != null && (
              <li>
                تغییر نسبت به روز قبل: {formatPct(stats.changePct)}
              </li>
            )}
            <li>
              تعداد روزهای نمودار: {visible.length.toLocaleString('fa-IR')}
            </li>
          </ul>
        </section>

        {answer && (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-7 text-white/85">
            {answer}
          </div>
        )}
      </div>

      <form
        onSubmit={onAsk}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#131314]/95 px-4 py-3 backdrop-blur sm:px-8"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2 rounded-full border border-white/10 bg-[#2c2c2e] px-3 py-2 shadow-lg">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg text-white/60">
            +
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-white/40"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="هر چیزی بپرسید..."
            disabled={askBusy}
          />
          <button
            type="submit"
            disabled={askBusy || !question.trim()}
            className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-[#131314] disabled:opacity-40"
          >
            {askBusy ? '...' : 'ارسال'}
          </button>
        </div>
      </form>
    </div>
  );
}
