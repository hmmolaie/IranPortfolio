'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';
import { DataFreshness } from '@/components/DataFreshness';

type Row = {
  key: string;
  instrumentId: string | null;
  symbol: string;
  nameFa: string | null;
  holders: number;
  buyers: number;
  sellers: number;
  avgWeightPct: number | null;
  net: number;
};

type Board = { noteFa: string; buys: Row[]; sells: Row[]; held: Row[] };

type Tab = 'buys' | 'sells' | 'held';

const TABS: Array<{ key: Tab; label: string; empty: string }> = [
  { key: 'buys', label: 'بیشترین خرید', empty: 'در آخرین گزارش‌ها خرید مشترکی دیده نشد.' },
  { key: 'sells', label: 'بیشترین فروش', empty: 'در آخرین گزارش‌ها فروش مشترکی دیده نشد.' },
  { key: 'held', label: 'پرطرفدارترین', empty: 'هنوز گزارش آنالیزشده‌ای از صندوق‌ها نیست.' },
];

export default function SmartMoneyPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('buys');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<Board>('/market/smart-money')
      .then(setBoard)
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const rows = board?.[tab] ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">پول هوشمند</h1>
        <p className="mt-2 text-navy-800/70">
          سهم‌هایی که صندوق‌های برتر در آخرین گزارش ماهانه خریده، فروخته یا نگه داشته‌اند.
        </p>
        <div className="mt-2">
          <DataFreshness keys={['fundReportMonth', 'stockPrices']} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.key ? 'bg-navy-900 text-white' : 'bg-navy-50 text-navy-800'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!board && !error && <p className="text-sm text-navy-800/60">در حال بارگذاری...</p>}

      {board && (
        <section className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-navy-900 text-white">
              <tr>
                <th className="px-3 py-3 text-start font-medium">نماد</th>
                <th className="px-3 py-3 text-start font-medium">نام</th>
                <th className="px-3 py-3 text-start font-medium">صندوق خریدار</th>
                <th className="px-3 py-3 text-start font-medium">صندوق فروشنده</th>
                <th className="px-3 py-3 text-start font-medium">صندوق دارنده</th>
                <th className="px-3 py-3 text-start font-medium">میانگین وزن در صندوق‌ها</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                  <td className="px-3 py-2.5 font-medium">
                    {r.instrumentId ? (
                      <Link href={`/market/${r.instrumentId}`} className="text-gold-700 hover:underline">
                        {r.symbol}
                      </Link>
                    ) : (
                      r.symbol
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-navy-800/75">{r.nameFa ?? '—'}</td>
                  <td className="px-3 py-2.5 text-emerald-700">{r.buyers ? r.buyers.toLocaleString('fa-IR') : '—'}</td>
                  <td className="px-3 py-2.5 text-red-700">{r.sellers ? r.sellers.toLocaleString('fa-IR') : '—'}</td>
                  <td className="px-3 py-2.5">{r.holders ? r.holders.toLocaleString('fa-IR') : '—'}</td>
                  <td className="px-3 py-2.5">{r.avgWeightPct != null ? `${formatNum(r.avgWeightPct)}٪` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-sm text-navy-800/60">{TABS.find((t) => t.key === tab)?.empty}</p>}
        </section>
      )}
      {board && <p className="text-xs leading-6 text-navy-800/55">{board.noteFa}</p>}
    </div>
  );
}
