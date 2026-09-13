'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';

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

type SeriesKey = 'rating' | 'managerTechnicalScore' | 'riskAppetiteScore' | 'professionalismScore';

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: 'rating', label: 'امتیاز کلی', color: '#0b1f3a' },
  { key: 'managerTechnicalScore', label: 'نمره فنی مدیر', color: '#a8893e' },
  { key: 'riskAppetiteScore', label: 'ریسک‌پذیری', color: '#4a6741' },
  { key: 'professionalismScore', label: 'حرفه‌ای‌بودن', color: '#5c6bc0' },
];

function periodLabel(r: FundReport) {
  if (r.reportYear && r.reportMonthNum) {
    return `${String(r.reportYear).slice(-2)}/${MONTHS_FA[r.reportMonthNum - 1]?.slice(0, 3) ?? r.reportMonthNum}`;
  }
  return r.reportMonth;
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

export default function FundTrendPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [fund, setFund] = useState<FundDefinition | null>(null);
  const [reports, setReports] = useState<FundReport[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ fund: FundDefinition; reports: FundReport[] }>(`/funds/timeline/${id}`)
      .then((data) => {
        setFund(data.fund);
        setReports(data.reports ?? []);
      })
      .catch((e) => {
        setError((e as Error).message);
      });
  }, [id, router]);

  const latest = useMemo(() => {
    if (!reports.length) return null;
    return [...reports].sort((a, b) => {
      const ay = a.reportYear ?? 0;
      const by = b.reportYear ?? 0;
      if (ay !== by) return by - ay;
      return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
    })[0];
  }, [reports]);

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
          روند امتیازات گزارش‌های ماهانه
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
        <h2 className="mb-4 text-lg font-semibold">نمودار روند</h2>
        <ScoreTrendChart reports={reports} />
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
