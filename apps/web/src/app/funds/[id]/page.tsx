'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken } from '@/lib/api';

type FundDefinition = {
  id: string;
  nameFa: string;
  symbolCode?: string | null;
};

type FundReport = {
  id: string;
  fundName: string;
  reportMonth: string;
  reportYear?: number | null;
  reportMonthNum?: number | null;
  rating?: number | null;
  managerTechnicalScore?: number | null;
  riskAppetiteScore?: number | null;
  professionalismScore?: number | null;
  guessedStrategyFa?: string | null;
};

type FundHolding = {
  id: string;
  symbol: string;
  nameFa: string;
  assetKind: string;
  action: string;
  weightPct?: number | null;
  amountRial?: number | null;
  quantity?: number | null;
};

type TrackedSymbol = { symbol: string; nameFa: string };

type SymbolTrend = {
  symbol: string;
  trend: 'up' | 'down' | 'flat' | 'unknown';
  points: Array<{
    reportId: string;
    symbol: string;
    nameFa: string;
    weightPct?: number | null;
    amountRial?: number | null;
    reportYear?: number | null;
    reportMonthNum?: number | null;
    reportMonth?: string | null;
  }>;
};

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

const ACTION_FA: Record<string, string> = {
  HELD: 'موجودی',
  BOUGHT: 'خرید',
  SOLD: 'فروش',
};

const TREND_FA: Record<string, string> = {
  up: 'افزایشی',
  down: 'کاهشی',
  flat: 'تقریباً ثابت',
  unknown: 'نامشخص',
};

type SeriesKey = 'rating' | 'managerTechnicalScore' | 'riskAppetiteScore' | 'professionalismScore';

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'rating', label: 'امتیاز کلی', color: '#0b1f3a' },
  { key: 'managerTechnicalScore', label: 'نمره فنی مدیر', color: '#a8893e' },
  { key: 'riskAppetiteScore', label: 'ریسک‌پذیری', color: '#4a6741' },
  { key: 'professionalismScore', label: 'حرفه‌ای‌بودن', color: '#5c6bc0' },
];

function periodLabel(r: { reportYear?: number | null; reportMonthNum?: number | null; reportMonth?: string | null }) {
  if (r.reportYear && r.reportMonthNum) {
    return `${String(r.reportYear).slice(-2)}/${MONTHS_FA[r.reportMonthNum - 1]?.slice(0, 3) ?? r.reportMonthNum}`;
  }
  return r.reportMonth ?? '—';
}

function ScoreTrendChart({ reports }: { reports: FundReport[] }) {
  const points = useMemo(() => {
    return [...reports].sort((a, b) => {
      const ay = a.reportYear ?? 0;
      const by = b.reportYear ?? 0;
      if (ay !== by) return ay - by;
      return (a.reportMonthNum ?? 0) - (b.reportMonthNum ?? 0);
    });
  }, [reports]);

  if (points.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-navy-800/55">
        برای رسم نمودار حداقل دو گزارش ماهانه لازم است.
      </p>
    );
  }

  const w = 720;
  const h = 280;
  const padL = 40;
  const padR = 20;
  const padT = 24;
  const padB = 40;
  const minY = 0;
  const maxY = 10;
  const n = points.length;

  function xAt(i: number) {
    return padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  }
  function yAt(v: number) {
    return padT + (1 - (v - minY) / (maxY - minY)) * (h - padT - padB);
  }

  const paths = SERIES.map((s) => {
    const coords = points
      .map((p, i) => {
        const v = p[s.key];
        if (v == null) return null;
        return `${xAt(i)},${yAt(v)}`;
      })
      .filter(Boolean);
    return { ...s, d: coords.length >= 2 ? `M ${coords.join(' L ')}` : '' };
  });

  const yTicks = [0, 2.5, 5, 7.5, 10];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[28rem]" role="img" aria-label="نمودار روند امتیازات">
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={yAt(t)}
              x2={w - padR}
              y2={yAt(t)}
              stroke="rgba(11,31,58,0.08)"
            />
            <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" className="fill-navy-800/45" fontSize={11}>
              {t}
            </text>
          </g>
        ))}

        {paths.map(
          (p) =>
            p.d && (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={2.2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
        )}

        {SERIES.map((s) =>
          points.map((p, i) => {
            const v = p[s.key];
            if (v == null) return null;
            return (
              <circle key={`${s.key}-${p.id}`} cx={xAt(i)} cy={yAt(v)} r={3.2} fill={s.color} />
            );
          }),
        )}

        {points.map((p, i) => (
          <text
            key={p.id}
            x={xAt(i)}
            y={h - 12}
            textAnchor="middle"
            className="fill-navy-800/50"
            fontSize={10}
          >
            {periodLabel(p)}
          </text>
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HoldingWeightChart({ trend }: { trend: SymbolTrend }) {
  const points = trend.points.filter((p) => p.weightPct != null);
  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-navy-800/55">
        برای روند وزن، حداقل دو ماه با وزن موجودی لازم است.
      </p>
    );
  }

  const w = 640;
  const h = 220;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const vals = points.map((p) => p.weightPct as number);
  const minY = Math.max(0, Math.min(...vals) - 0.5);
  const maxY = Math.max(...vals) + 0.5;
  const n = points.length;

  function xAt(i: number) {
    return padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  }
  function yAt(v: number) {
    return padT + (1 - (v - minY) / Math.max(0.01, maxY - minY)) * (h - padT - padB);
  }

  const d = points.map((p, i) => `${xAt(i)},${yAt(p.weightPct as number)}`).join(' L ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[24rem]" role="img" aria-label="روند وزن نماد">
        <path
          d={`M ${d}`}
          fill="none"
          stroke="#a8893e"
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <g key={p.reportId}>
            <circle cx={xAt(i)} cy={yAt(p.weightPct as number)} r={3.5} fill="#0b1f3a" />
            <text x={xAt(i)} y={h - 10} textAnchor="middle" className="fill-navy-800/50" fontSize={10}>
              {periodLabel(p)}
            </text>
            <text
              x={xAt(i)}
              y={yAt(p.weightPct as number) - 8}
              textAnchor="middle"
              className="fill-navy-800/70"
              fontSize={10}
            >
              {formatNum(p.weightPct)}٪
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function FundTrendPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [fund, setFund] = useState<FundDefinition | null>(null);
  const [reports, setReports] = useState<FundReport[]>([]);
  const [error, setError] = useState('');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [holdings, setHoldings] = useState<FundHolding[]>([]);
  const [symbols, setSymbols] = useState<TrackedSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [symbolTrend, setSymbolTrend] = useState<SymbolTrend | null>(null);
  const [actionFilter, setActionFilter] = useState<'ALL' | 'HELD' | 'BOUGHT' | 'SOLD'>('ALL');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ fund: FundDefinition; reports: FundReport[] }>(`/funds/timeline/${id}`)
      .then((data) => {
        setFund(data.fund);
        const reps = data.reports ?? [];
        setReports(reps);
        const sorted = [...reps].sort((a, b) => {
          const ay = a.reportYear ?? 0;
          const by = b.reportYear ?? 0;
          if (ay !== by) return by - ay;
          return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
        });
        if (sorted[0]) setSelectedReportId(sorted[0].id);
      })
      .catch((e) => {
        setError((e as Error).message);
      });

    api<TrackedSymbol[]>(`/funds/definitions/${id}/symbols`)
      .then((list) => {
        setSymbols(list);
        if (list[0]) setSelectedSymbol(list[0].symbol);
      })
      .catch(() => setSymbols([]));
  }, [id, router]);

  useEffect(() => {
    if (!selectedReportId) {
      setHoldings([]);
      return;
    }
    api<FundHolding[]>(`/funds/definitions/${id}/holdings?reportId=${encodeURIComponent(selectedReportId)}`)
      .then(setHoldings)
      .catch(() => setHoldings([]));
  }, [id, selectedReportId]);

  useEffect(() => {
    if (!selectedSymbol) {
      setSymbolTrend(null);
      return;
    }
    api<SymbolTrend>(
      `/funds/definitions/${id}/symbol-trend?symbol=${encodeURIComponent(selectedSymbol)}`,
    )
      .then(setSymbolTrend)
      .catch(() => setSymbolTrend(null));
  }, [id, selectedSymbol]);

  const latest = useMemo(() => {
    if (!reports.length) return null;
    return [...reports].sort((a, b) => {
      const ay = a.reportYear ?? 0;
      const by = b.reportYear ?? 0;
      if (ay !== by) return by - ay;
      return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
    })[0];
  }, [reports]);

  const filteredHoldings = useMemo(() => {
    if (actionFilter === 'ALL') return holdings;
    return holdings.filter((h) => h.action === actionFilter);
  }, [holdings, actionFilter]);

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/funds" className="text-sm text-navy-800/60 hover:underline">
          ← بازگشت به صندوق‌ها
        </Link>
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (!fund) {
    return <p className="text-navy-800/60">در حال بارگذاری...</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/funds" className="text-sm text-navy-800/60 hover:underline">
          ← بازگشت به صندوق‌ها
        </Link>
        <h1 className="mt-3 text-3xl font-bold">{fund.nameFa}</h1>
        <p className="mt-2 text-navy-800/70">
          روند امتیازات و دارایی‌های ماهانه
          {fund.symbolCode ? ` · ${fund.symbolCode}` : ''}
        </p>
      </div>

      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SERIES.map((s) => (
            <div key={s.key} className="card text-center !py-4">
              <div className="text-xs text-navy-800/55">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold" style={{ color: s.color }}>
                {formatNum(latest[s.key])}
              </div>
              <div className="text-[10px] text-navy-800/40">آخرین گزارش</div>
            </div>
          ))}
        </div>
      )}

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">نمودار روند امتیازات</h2>
        <ScoreTrendChart reports={reports} />
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">دارایی‌های گزارش ماهانه</h2>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-navy-800/55">دوره</span>
              <select
                className="rounded-lg border border-navy-900/15 bg-white px-3 py-2 text-sm"
                value={selectedReportId}
                onChange={(e) => setSelectedReportId(e.target.value)}
              >
                {[...reports]
                  .sort((a, b) => {
                    const ay = a.reportYear ?? 0;
                    const by = b.reportYear ?? 0;
                    if (ay !== by) return by - ay;
                    return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
                  })
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.reportYear && r.reportMonthNum
                        ? `${r.reportYear.toLocaleString('fa-IR', { useGrouping: false })} / ${MONTHS_FA[r.reportMonthNum - 1]}`
                        : r.reportMonth}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-navy-800/55">نوع ردیف</span>
              <select
                className="rounded-lg border border-navy-900/15 bg-white px-3 py-2 text-sm"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as typeof actionFilter)}
              >
                <option value="ALL">همه</option>
                <option value="HELD">موجودی</option>
                <option value="BOUGHT">خرید</option>
                <option value="SOLD">فروش</option>
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="px-3 py-2 text-start font-medium">نماد</th>
                <th className="px-3 py-2 text-start font-medium">نام</th>
                <th className="px-3 py-2 text-start font-medium">نوع</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">وزن ٪</th>
                <th className="px-3 py-2 text-start font-medium">مبلغ</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.map((h) => (
                <tr key={h.id} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                  <td className="px-3 py-2 font-medium">
                    <button
                      type="button"
                      className="text-gold-700 hover:underline"
                      onClick={() => setSelectedSymbol(h.symbol)}
                    >
                      {h.symbol}
                    </button>
                  </td>
                  <td className="px-3 py-2">{h.nameFa}</td>
                  <td className="px-3 py-2">{KIND_FA[h.assetKind] ?? h.assetKind}</td>
                  <td className="px-3 py-2">{ACTION_FA[h.action] ?? h.action}</td>
                  <td className="px-3 py-2">{h.weightPct != null ? formatNum(h.weightPct) : '—'}</td>
                  <td className="px-3 py-2">{h.amountRial != null ? formatRial(h.amountRial) : '—'}</td>
                  <td className="px-3 py-2">{h.quantity != null ? formatNum(h.quantity) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredHoldings.length === 0 && (
            <p className="p-6 text-sm text-navy-800/60">
              برای این دوره دارایی ذخیره‌شده‌ای نیست. پس از بارگذاری و آنالیز مجدد گزارش، ردیف‌ها اینجا می‌آیند.
            </p>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">روند نماد در سبد صندوق</h2>
            <p className="mt-1 text-sm text-navy-800/60">
              وزن موجودی (HELD) در ماه‌های متوالی — افزایش یعنی سهم در سبد صندوق بیشتر شده است.
            </p>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-navy-800/55">نماد</span>
            <select
              className="min-w-[10rem] rounded-lg border border-navy-900/15 bg-white px-3 py-2 text-sm"
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
            >
              {symbols.length === 0 && <option value="">نماد ثبت‌نشده</option>}
              {symbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.symbol}
                  {s.nameFa && s.nameFa !== s.symbol ? ` — ${s.nameFa}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {symbolTrend && (
          <>
            <p className="text-sm">
              روند کلی:{' '}
              <span className="font-semibold">{TREND_FA[symbolTrend.trend] ?? symbolTrend.trend}</span>
            </p>
            <HoldingWeightChart trend={symbolTrend} />
            {symbolTrend.points.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-navy-900/90 text-white">
                    <tr>
                      <th className="px-3 py-2 text-start">دوره</th>
                      <th className="px-3 py-2 text-start">وزن ٪</th>
                      <th className="px-3 py-2 text-start">مبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {symbolTrend.points.map((p) => (
                      <tr key={p.reportId} className="border-b border-navy-900/5">
                        <td className="px-3 py-2">{periodLabel(p)}</td>
                        <td className="px-3 py-2">{p.weightPct != null ? formatNum(p.weightPct) : '—'}</td>
                        <td className="px-3 py-2">
                          {p.amountRial != null ? formatRial(p.amountRial) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">دوره</th>
              <th className="px-4 py-3 text-start font-medium">کلی</th>
              <th className="px-4 py-3 text-start font-medium">فنی</th>
              <th className="px-4 py-3 text-start font-medium">ریسک</th>
              <th className="px-4 py-3 text-start font-medium">حرفه‌ای</th>
            </tr>
          </thead>
          <tbody>
            {[...reports]
              .sort((a, b) => {
                const ay = a.reportYear ?? 0;
                const by = b.reportYear ?? 0;
                if (ay !== by) return by - ay;
                return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
              })
              .map((r) => (
                <tr key={r.id} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                  <td className="px-4 py-3 font-medium">
                    {r.reportYear && r.reportMonthNum
                      ? `${r.reportYear.toLocaleString('fa-IR', { useGrouping: false })} / ${MONTHS_FA[r.reportMonthNum - 1]}`
                      : r.reportMonth}
                  </td>
                  <td className="px-4 py-3">{formatNum(r.rating)}</td>
                  <td className="px-4 py-3">{formatNum(r.managerTechnicalScore)}</td>
                  <td className="px-4 py-3">{formatNum(r.riskAppetiteScore)}</td>
                  <td className="px-4 py-3">{formatNum(r.professionalismScore)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {reports.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">گزارشی برای این صندوق ثبت نشده.</p>
        )}
      </section>
    </div>
  );
}
