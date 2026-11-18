'use client';

import { useEffect, useState } from 'react';
import { api, formatRial } from '@/lib/api';
import { formatShamsiDate } from '@/lib/shamsi-date';

type Point = {
  labelFa: string;
  days: number;
  valuePct: number | null;
  usdPct: number | null;
  goldPct: number | null;
};

type Build = {
  snapshotId: string;
  kind: string;
  createdAt: string;
  investedRial: number;
  items: number;
  points: Point[];
};

function PctCell({ value, best }: { value: number | null; best?: boolean }) {
  if (value == null) return <span className="text-navy-800/35">—</span>;
  return (
    <span
      dir="ltr"
      className={`${value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-700' : ''}${best ? ' font-semibold' : ''}`}
    >
      {value > 0 ? '+' : ''}
      {value.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪
    </span>
  );
}

/** کارنامهٔ پیشنهادها: بازدهی هر ساخت یا بازچینش System One کنار دلار و طلا */
export function PortfolioTrackRecord({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<{ noteFa: string; builds: Build[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ noteFa: string; builds: Build[] }>(`/portfolios/${portfolioId}/track-record`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [portfolioId]);

  if (error) return null;
  if (!data || !data.builds.length) return null;
  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-lg font-semibold">کارنامهٔ پیشنهادها</h2>
        <p className="mt-1 text-sm leading-7 text-navy-800/60">{data.noteFa}</p>
      </div>
      {data.builds.map((b) => (
        <div key={b.snapshotId} className="overflow-x-auto rounded-lg border border-navy-900/10">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-navy-50/60 px-3 py-2 text-sm">
            <span className="font-medium">
              {b.kind === 'REBALANCE' ? 'بازچینش' : 'ساخت سبد'} {formatShamsiDate(b.createdAt, 'long')}
            </span>
            <span className="text-xs text-navy-800/55">
              {b.items.toLocaleString('fa-IR')} قلم · {formatRial(b.investedRial)}
            </span>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-navy-800/55">
                <th className="px-3 py-2 text-start font-medium">زمان</th>
                <th className="px-3 py-2 text-start font-medium">سبد</th>
                <th className="px-3 py-2 text-start font-medium">دلار</th>
                <th className="px-3 py-2 text-start font-medium">طلا</th>
              </tr>
            </thead>
            <tbody>
              {b.points.map((p) => {
                const vals = [p.valuePct, p.usdPct, p.goldPct].filter((v): v is number => v != null);
                const top = vals.length ? Math.max(...vals) : null;
                return (
                  <tr key={p.labelFa} className="border-t border-navy-900/5">
                    <td className="px-3 py-2">
                      {p.labelFa}
                      {p.labelFa === 'امروز' && (
                        <span className="text-xs text-navy-800/45"> ({p.days.toLocaleString('fa-IR')} روز)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <PctCell value={p.valuePct} best={top != null && p.valuePct === top} />
                    </td>
                    <td className="px-3 py-2">
                      <PctCell value={p.usdPct} best={top != null && p.usdPct === top} />
                    </td>
                    <td className="px-3 py-2">
                      <PctCell value={p.goldPct} best={top != null && p.goldPct === top} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

type CodalEvent = {
  symbol: string;
  instrumentId: string;
  kind: string;
  kindFa: string;
  titleFa: string;
  publishedAtFa: string;
  tracingNo: number;
  url: string;
};

const KIND_CLASS: Record<string, string> = {
  assembly: 'bg-navy-900 text-white',
  capital: 'bg-gold-500/20 text-navy-900',
  dividend: 'bg-emerald-100 text-emerald-900',
  financial: 'bg-navy-50 text-navy-800',
};

/** رویدادهای کدال سهم‌های سبد: مجمع، افزایش سرمایه، سود نقدی و صورت مالی */
export function PortfolioCodalEvents({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<{ symbols: number; events: CodalEvent[]; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setData(await api(`/portfolios/${portfolioId}/codal-events`));
    } catch {
      setData({ symbols: 0, events: [], errors: ['خواندن اطلاعیه‌های کدال ناموفق بود.'] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">رویدادهای کدال سهم‌های سبد</h2>
          <p className="mt-1 text-sm text-navy-800/60">مجمع، افزایش سرمایه، سود نقدی و صورت مالی از اطلاعیه‌های کدال</p>
        </div>
        {!open && (
          <button
            type="button"
            className="btn-secondary"
            disabled={loading}
            onClick={() => {
              setOpen(true);
              void load();
            }}
          >
            نمایش رویدادها
          </button>
        )}
      </div>
      {open && loading && <p className="text-sm text-navy-800/60">در حال خواندن اطلاعیه‌ها؛ بار اول ممکن است کمی طول بکشد...</p>}
      {open && data && !loading && (
        <>
          {data.events.length === 0 ? (
            <p className="text-sm text-navy-800/55">
              {data.symbols === 0 ? 'سهم یا صندوقی در این سبد نیست.' : 'رویداد مهمی در اطلاعیه‌های اخیر پیدا نشد.'}
            </p>
          ) : (
            <ul className="divide-y divide-navy-900/5">
              {data.events.map((e) => (
                <li key={`${e.instrumentId}-${e.tracingNo}`} className="flex flex-wrap items-start gap-2 py-2 text-sm">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${KIND_CLASS[e.kind] ?? 'bg-navy-50'}`}>{e.kindFa}</span>
                  <span className="font-medium">{e.symbol}</span>
                  <a href={e.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 leading-6 text-navy-900 hover:underline">
                    {e.titleFa}
                  </a>
                  <span className="text-xs text-navy-800/50">{e.publishedAtFa}</span>
                </li>
              ))}
            </ul>
          )}
          {data.errors.length > 0 && <p className="text-xs text-amber-700">{data.errors.join(' · ')}</p>}
        </>
      )}
    </section>
  );
}
