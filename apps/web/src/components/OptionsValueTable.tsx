'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatNum } from '@/lib/api';

export type OptionsTableRow = {
  id: string;
  symbol: string;
  nameFa: string;
  side: 'CALL' | 'PUT';
  sideFa: string;
  underlyingSymbol: string;
  underlyingPrice: number | null;
  strike: number;
  premium: number | null;
  daysLeft: number | null;
  contractSize: number | null;
  profitPerUnit: number | null;
  profitRial: number | null;
  profitPct: number | null;
  realProfitRial: number | null;
  realProfitPct: number | null;
  tradeVolume?: number | null;
  buyQueueVolume?: number | null;
  sellQueueVolume?: number | null;
  reasonFa: string;
};

type SortKey =
  | 'symbol'
  | 'side'
  | 'underlying'
  | 'underlyingPrice'
  | 'strike'
  | 'premium'
  | 'buyQueue'
  | 'sellQueue'
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
  { key: 'buyQueue', label: 'حجم صف خرید' },
  { key: 'sellQueue', label: 'حجم صف فروش' },
  { key: 'daysLeft', label: 'روز مانده' },
  { key: 'profit', label: 'سود' },
  { key: 'realProfit', label: 'سود واقعی' },
];

function parseFilterNumber(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/,/g, '.')
    .replace(/٫/g, '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatQueue(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatNum(value);
}

function sortValue(row: OptionsTableRow, key: SortKey): string | number | null {
  if (key === 'symbol') return row.symbol;
  if (key === 'side') return row.sideFa;
  if (key === 'underlying') return row.underlyingSymbol;
  if (key === 'underlyingPrice') return row.underlyingPrice;
  if (key === 'strike') return row.strike;
  if (key === 'premium') return row.premium;
  if (key === 'buyQueue') return row.buyQueueVolume ?? null;
  if (key === 'sellQueue') return row.sellQueueVolume ?? null;
  if (key === 'daysLeft') return row.daysLeft;
  if (key === 'realProfit') return row.realProfitRial;
  return row.profitRial;
}

export function OptionsValueTable({
  items,
  loading,
}: {
  items: OptionsTableRow[] | null;
  loading?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [side, setSide] = useState<'' | 'CALL' | 'PUT'>('');
  const [listing, setListing] = useState<'all' | 'traded'>('all');
  const [minPremium, setMinPremium] = useState('1');
  const [minBuyQueue, setMinBuyQueue] = useState('');
  const [minSellQueue, setMinSellQueue] = useState('');
  const [sort, setSort] = useState<SortKey>('profit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [visible, setVisible] = useState(40);

  const rows = useMemo(() => {
    const text = q.trim();
    const premiumFloor = parseFilterNumber(minPremium);
    const buyFloor = parseFilterNumber(minBuyQueue);
    const sellFloor = parseFilterNumber(minSellQueue);
    const list = (items ?? []).filter((row) => {
      if (side && row.side !== side) return false;
      if (text && !row.symbol.includes(text)) return false;
      if (listing === 'traded' && !(row.tradeVolume != null && row.tradeVolume > 0)) return false;
      if (premiumFloor != null && !(row.premium != null && row.premium > premiumFloor)) return false;
      if (buyFloor != null && !(row.buyQueueVolume != null && row.buyQueueVolume >= buyFloor)) return false;
      if (sellFloor != null && !(row.sellQueueVolume != null && row.sellQueueVolume >= sellFloor)) return false;
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
  }, [items, q, side, listing, minPremium, minBuyQueue, minSellQueue, sort, sortDir]);

  useEffect(() => {
    setVisible(40);
  }, [items, q, side, listing, minPremium, minBuyQueue, minSellQueue, sort, sortDir]);

  const shown = rows.slice(0, visible);

  function toggleSort(column: SortKey) {
    if (sort === column) {
      setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setSort(column);
    setSortDir('desc');
  }

  return (
    <>
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
        <select className="input max-w-xs" value={listing} onChange={(e) => setListing(e.target.value as 'all' | 'traded')}>
          <option value="all">تمام نمادها</option>
          <option value="traded">نمادهای معامله شده</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-navy-800/80">
          اختیار بزرگتر از
          <input
            className="input w-28"
            dir="ltr"
            inputMode="decimal"
            value={minPremium}
            onChange={(e) => setMinPremium(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-navy-800/80">
          حجم صف خرید از
          <input
            className="input w-28"
            dir="ltr"
            inputMode="decimal"
            value={minBuyQueue}
            onChange={(e) => setMinBuyQueue(e.target.value)}
            placeholder="خالی"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-navy-800/80">
          حجم صف فروش از
          <input
            className="input w-28"
            dir="ltr"
            inputMode="decimal"
            value={minSellQueue}
            onChange={(e) => setMinSellQueue(e.target.value)}
            placeholder="خالی"
          />
        </label>
        {items && (
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
            {shown.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40 hover:bg-gold-400/10"
                onClick={() => router.push(`/market/${row.id}`)}
              >
                <td className="px-3 py-2.5 font-medium">{row.symbol}</td>
                <td className="px-3 py-2.5">{row.sideFa}</td>
                <td className="px-3 py-2.5">{row.underlyingSymbol}</td>
                <td className="px-3 py-2.5">{row.underlyingPrice == null ? '—' : formatNum(row.underlyingPrice)}</td>
                <td className="px-3 py-2.5">{formatNum(row.strike)}</td>
                <td className="px-3 py-2.5">{row.premium == null || !(row.premium > 0) ? '—' : formatNum(row.premium)}</td>
                <td className="px-3 py-2.5">{formatQueue(row.buyQueueVolume)}</td>
                <td className="px-3 py-2.5">{formatQueue(row.sellQueueVolume)}</td>
                <td className="px-3 py-2.5">
                  {row.daysLeft == null ? '—' : Math.round(row.daysLeft).toLocaleString('fa-IR')}
                </td>
                <td className="px-3 py-2.5">
                  {row.profitRial == null || row.profitPct == null ? (
                    <span className="text-navy-800/45">—</span>
                  ) : (
                    <>
                      <div className={row.profitRial >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                        {Math.round(row.profitRial).toLocaleString('fa-IR')}
                      </div>
                      <div className="text-xs text-navy-800/55">
                        {row.profitPct.toLocaleString('fa-IR')}٪ نسبت به قیمت اختیار
                        {row.contractSize != null ? ` · اندازه ${formatNum(row.contractSize)}` : ''}
                      </div>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {row.realProfitRial == null || row.realProfitPct == null ? (
                    <span className="text-navy-800/45">—</span>
                  ) : (
                    <>
                      <div className={row.realProfitRial >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
                        {Math.round(row.realProfitRial).toLocaleString('fa-IR')}
                      </div>
                      <div className="text-xs text-navy-800/55">
                        {Math.round(row.realProfitPct).toLocaleString('fa-IR')}٪ پس از تورم{' '}
                        {row.daysLeft == null ? '—' : Math.round(row.daysLeft).toLocaleString('fa-IR')} روز
                      </div>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && items.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">
            اختیار سررسیدنشده‌ای در دادهٔ امروز نیست.
          </p>
        )}
        {items && items.length > 0 && rows.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">نمادی با این فیلتر پیدا نشد.</p>
        )}
        {shown.length < rows.length && (
          <div className="flex justify-center p-4">
            <button type="button" className="btn-secondary" onClick={() => setVisible((count) => count + 40)}>
              نمایش {Math.min(40, rows.length - shown.length).toLocaleString('fa-IR')} ردیف دیگر
            </button>
          </div>
        )}
        {!items && loading && <p className="p-6 text-sm text-navy-800/60">در حال بارگذاری...</p>}
      </section>
    </>
  );
}
