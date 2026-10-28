'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';

type ValuableOption = {
  id: string;
  symbol: string;
  nameFa: string;
  side: 'CALL' | 'PUT';
  sideFa: string;
  underlyingSymbol: string;
  underlyingPrice: number;
  strike: number;
  premium: number;
  daysLeft: number;
  contractSize: number | null;
  profitPerUnit: number;
  profitRial: number;
  profitPct: number;
  realProfitRial: number | null;
  realProfitPct: number | null;
  reasonFa: string;
};

type Payload = {
  disclaimerFa: string;
  inflationPct: number | null;
  items: ValuableOption[];
};

type SortKey =
  | 'symbol'
  | 'side'
  | 'underlying'
  | 'underlyingPrice'
  | 'strike'
  | 'premium'
  | 'daysLeft'
  | 'profit'
  | 'realProfit';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'symbol', label: 'نماد' },
  { key: 'side', label: 'نوع' },
  { key: 'underlying', label: 'دارایی پایه' },
  { key: 'underlyingPrice', label: 'قیمت پایه' },
  { key: 'strike', label: 'اعمال' },
  { key: 'premium', label: 'قیمت اختیار' },
  { key: 'daysLeft', label: 'روز مانده' },
  { key: 'profit', label: 'سود' },
  { key: 'realProfit', label: 'سود واقعی' },
];

function sortValue(row: ValuableOption, key: SortKey): string | number | null {
  if (key === 'symbol') return row.symbol;
  if (key === 'side') return row.sideFa;
  if (key === 'underlying') return row.underlyingSymbol;
  if (key === 'underlyingPrice') return row.underlyingPrice;
  if (key === 'strike') return row.strike;
  if (key === 'premium') return row.premium;
  if (key === 'daysLeft') return row.daysLeft;
  if (key === 'realProfit') return row.realProfitRial;
  return row.profitRial;
}

export default function OptionsMarketPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [side, setSide] = useState<'' | 'CALL' | 'PUT'>('');
  const [sort, setSort] = useState<SortKey>('profit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(() => {
    const text = q.trim();
    const list = (data?.items ?? []).filter((row) => {
      if (side && row.side !== side) return false;
      if (text && !row.symbol.includes(text)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const left = sortValue(a, sort);
      const right = sortValue(b, sort);
      if (left == null || right == null) {
        if (left == null && right == null) return a.symbol.localeCompare(b.symbol, 'fa');
        return left == null ? 1 : -1;
      }
      const cmp =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'fa');
      if (cmp !== 0) return cmp * dir;
      return a.symbol.localeCompare(b.symbol, 'fa');
    });
    return list;
  }, [data, q, side, sort, sortDir]);

  function toggleSort(column: SortKey) {
    if (sort === column) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSort(column);
    setSortDir('desc');
  }

  function loadOptions() {
    return api<Payload>('/market/option-value')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ role?: UserRole }>('/users/me')
      .then((u) => {
        const admin = u.role === 'ADMIN' || getUserRole() === 'ADMIN';
        if (u.role) setUserRole(u.role);
        setIsAdmin(admin);
      })
      .catch(() => undefined);
    void loadOptions();
  }, [router]);

  async function refreshNow() {
    setRefreshing(true);
    setNotice('');
    setError('');
    try {
      const res = await api<{ messageFa?: string }>('/market/options/refresh', { method: 'POST' });
      setNotice(res.messageFa || 'اختیار معامله به‌روز شد.');
      await loadOptions();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'به‌روزرسانی اختیار معامله ناموفق بود.';
      setError(
        /failed to fetch|networkerror|load failed/i.test(raw)
          ? 'ارتباط با سرور هنگام به‌روزرسانی قطع شد. متن خطا در بخش خطاهای مشاهده‌شدهٔ تنظیمات ادمین می‌ماند.'
          : raw,
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-3xl font-bold">بازار اختیار معامله</h1>
        <p className="mt-2 text-navy-800/70">
          فقط اختیارهای فعال که سررسیدشان نگذشته و سودشان نسبت به قیمت دارایی پایه قابل توجه است. سود واقعی، همین سود را پس از تورمِ روزهای مانده تا سررسید نشان می‌دهد.
          {data?.inflationPct != null
            ? ` نرخ تورم سالانه: ${data.inflationPct.toLocaleString('fa-IR')}٪.`
            : data
              ? ' نرخ تورم سالانه در اقتصاد ایران ثبت نشده است.'
              : ''}
        </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn-primary" onClick={() => void refreshNow()} disabled={refreshing}>
            {refreshing ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی لحظه‌ای'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-navy-800/80">{notice}</p>}
      {data && <p className="text-sm text-navy-800/60">{data.disclaimerFa}</p>}

      <div className="card flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="جستجوی نماد..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input max-w-xs" value={side} onChange={(e) => setSide(e.target.value as '' | 'CALL' | 'PUT')}>
          <option value="">همهٔ انواع</option>
          <option value="CALL">اختیار خرید</option>
          <option value="PUT">اختیار فروش</option>
        </select>
        {data && (
          <span className="self-center text-sm text-navy-800/55">
            {rows.length.toLocaleString('fa-IR')} نماد
          </span>
        )}
      </div>

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} className="px-3 py-3 text-start font-medium">
                  <button type="button" className="font-medium text-white" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    {sort === column.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40 hover:bg-gold-400/10"
                onClick={() => router.push(`/market/${row.id}`)}
              >
                <td className="px-3 py-2.5 font-medium">{row.symbol}</td>
                <td className="px-3 py-2.5">{row.sideFa}</td>
                <td className="px-3 py-2.5">{row.underlyingSymbol}</td>
                <td className="px-3 py-2.5">{formatNum(row.underlyingPrice)}</td>
                <td className="px-3 py-2.5">{formatNum(row.strike)}</td>
                <td className="px-3 py-2.5">{formatNum(row.premium)}</td>
                <td className="px-3 py-2.5">{Math.round(row.daysLeft).toLocaleString('fa-IR')}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-emerald-700">{formatNum(row.profitRial)}</div>
                  <div className="text-xs text-navy-800/55">
                    {row.profitPct.toLocaleString('fa-IR')}٪ نسبت به قیمت اختیار
                    {row.contractSize != null ? ` · اندازه ${formatNum(row.contractSize)}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {row.realProfitRial == null || row.realProfitPct == null ? (
                    <span className="text-navy-800/45">—</span>
                  ) : (
                    <>
                      <div className={row.realProfitRial >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                        {formatNum(row.realProfitRial)}
                      </div>
                      <div className="text-xs text-navy-800/55">
                        {row.realProfitPct.toLocaleString('fa-IR')}٪ پس از تورم {Math.round(row.daysLeft).toLocaleString('fa-IR')} روز
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">
            اختیار ارزشمندی با سود قابل توجه و سررسید باقی‌مانده در دادهٔ امروز نیست.
          </p>
        )}
        {data && data.items.length > 0 && rows.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">نمادی با این فیلتر پیدا نشد.</p>
        )}
        {!data && !error && <p className="p-6 text-sm text-navy-800/60">در حال بارگذاری...</p>}
      </section>
    </div>
  );
}
