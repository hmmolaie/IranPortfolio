'use client';

import { useEffect, useState } from 'react';
import { api, formatNum, getToken } from '@/lib/api';
import { useRouter } from 'next/navigation';

type Quote = {
  id: string;
  symbol: string;
  nameFa: string;
  assetType: string;
  last: {
    lastPrice?: number | null;
    closePrice?: number | null;
    eps?: number | null;
    pe?: number | null;
    tradeDate?: string;
  } | null;
};

const ASSET_FA: Record<string, string> = {
  STOCK: 'سهام',
  GOLD_ETF: 'طلا',
  OPTION: 'اختیار',
  DEPOSIT: 'سپرده',
  FUND: 'صندوق',
  CASH: 'نقد',
};

export default function MarketPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [q, setQ] = useState('');
  const [assetType, setAssetType] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (assetType) params.set('assetType', assetType);
    params.set('take', '150');
    const data = await api<Quote[]>(`/market/quotes?${params}`);
    setQuotes(data);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => undefined);
  }, [router]);

  async function ingest() {
    setLoading(true);
    setMsg('');
    try {
      const res = await api<{ upserted: number; tradeDate: string }>('/market/ingest', {
        method: 'POST',
      });
      setMsg(`به‌روزرسانی انجام شد: ${res.upserted.toLocaleString('fa-IR')} نماد برای ${res.tradeDate}`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">بازار امروز</h1>
          <p className="mt-2 text-navy-800/70">قیمت، EPS و P/E ذخیره‌شده به تاریخ روز</p>
        </div>
        <button className="btn-primary" onClick={ingest} disabled={loading}>
          {loading ? 'در حال دریافت...' : 'به‌روزرسانی از TSETMC'}
        </button>
      </div>

      {msg && <p className="text-sm text-navy-800/80">{msg}</p>}

      <div className="card flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="جستجوی نماد..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input max-w-xs" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
          <option value="">همه دارایی‌ها</option>
          <option value="STOCK">سهام</option>
          <option value="GOLD_ETF">طلا</option>
          <option value="OPTION">اختیار</option>
          <option value="DEPOSIT">سپرده</option>
        </select>
        <button className="btn-secondary" onClick={() => load()}>
          اعمال فیلتر
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">نماد</th>
              <th className="px-4 py-3 text-start font-medium">نام</th>
              <th className="px-4 py-3 text-start font-medium">نوع</th>
              <th className="px-4 py-3 text-start font-medium">آخرین</th>
              <th className="px-4 py-3 text-start font-medium">پایانی</th>
              <th className="px-4 py-3 text-start font-medium">EPS</th>
              <th className="px-4 py-3 text-start font-medium">P/E</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((row) => (
              <tr key={row.id} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                <td className="px-4 py-2.5 font-medium">{row.symbol}</td>
                <td className="px-4 py-2.5">{row.nameFa}</td>
                <td className="px-4 py-2.5">{ASSET_FA[row.assetType] ?? row.assetType}</td>
                <td className="px-4 py-2.5">{formatNum(row.last?.lastPrice)}</td>
                <td className="px-4 py-2.5">{formatNum(row.last?.closePrice)}</td>
                <td className="px-4 py-2.5">{formatNum(row.last?.eps)}</td>
                <td className="px-4 py-2.5">{formatNum(row.last?.pe)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {quotes.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">داده‌ای نیست. دکمه به‌روزرسانی را بزنید.</p>
        )}
      </div>
    </div>
  );
}
