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
  let normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/[\s\u066C\u066B'_’]/g, (ch) => (ch === '\u066B' ? '.' : ''))
    .replace(/،/g, '')
    .replace(/٫/g, '.');
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = normalized.split(',');
    const thousands = parts.length > 1 && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    normalized = thousands ? parts.join('') : normalized.replace(',', '.');
  } else if (lastDot >= 0) {
    const parts = normalized.split('.');
    const thousands = parts.length > 2 && parts.slice(1).every((part) => /^\d{3}$/.test(part));
    if (thousands) normalized = parts.join('');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function rowNumber(value: number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type OptionFilters = {
  q: string;
  side: '' | 'CALL' | 'PUT';
  listing: 'all' | 'traded';
  minPremium: string;
  minBuyQueue: string;
  minSellQueue: string;
  minDays: string;
  maxDays: string;
};

const INITIAL_FILTERS: OptionFilters = {
  q: '',
  side: '',
  listing: 'all',
  minPremium: '1',
  minBuyQueue: '',
  minSellQueue: '',
  minDays: '',
  maxDays: '',
};

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
  compact,
}: {
  items: OptionsTableRow[] | null;
  loading?: boolean;
  /** صفحهٔ یک سهم: بدون فیلتر، اول ۵ ردیف و با «نمایش بیشتر» همهٔ فهرست */
  compact?: boolean;
}) {
  const router = useRouter();
  const pageSize = compact ? 5 : 40;
  const [draft, setDraft] = useState<OptionFilters>(INITIAL_FILTERS);
  const [applied, setApplied] = useState<OptionFilters>(INITIAL_FILTERS);
  const [sort, setSort] = useState<SortKey>('profit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [visible, setVisible] = useState(pageSize);

  const rows = useMemo(() => {
    const text = applied.q.trim();
    const premiumFloor = parseFilterNumber(applied.minPremium);
    const buyFloor = parseFilterNumber(applied.minBuyQueue);
    const sellFloor = parseFilterNumber(applied.minSellQueue);
    const minDays = parseFilterNumber(applied.minDays);
    const maxDays = parseFilterNumber(applied.maxDays);
    const list = (items ?? []).filter((row) => {
      if (applied.side && row.side !== applied.side) return false;
      if (text && !row.symbol.includes(text)) return false;
      const tradeVolume = rowNumber(row.tradeVolume);
      if (applied.listing === 'traded' && !(tradeVolume != null && tradeVolume > 0)) return false;
      const premium = rowNumber(row.premium);
      if (premiumFloor != null && !(premium != null && premium > premiumFloor)) return false;
      const buyQueue = rowNumber(row.buyQueueVolume);
      if (buyFloor != null && !(buyQueue != null && buyQueue >= buyFloor)) return false;
      const sellQueue = rowNumber(row.sellQueueVolume);
      if (sellFloor != null && !(sellQueue != null && sellQueue >= sellFloor)) return false;
      const daysLeft = rowNumber(row.daysLeft);
      const daysRounded = daysLeft == null ? null : Math.round(daysLeft);
      if (minDays != null && !(daysRounded != null && daysRounded >= minDays)) return false;
      if (maxDays != null && !(daysRounded != null && daysRounded <= maxDays)) return false;
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
  }, [items, applied, sort, sortDir]);

  useEffect(() => {
    setVisible(pageSize);
  }, [items, applied, sort, sortDir, pageSize]);

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
      {!compact && (
        <form
          className="card space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(draft);
          }}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-2">
              <label className="label" htmlFor="opt-q">
                جستجوی نماد
              </label>
              <input
                id="opt-q"
                className="input"
                placeholder="مثلاً ضملی"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="opt-side">
                نوع اختیار
              </label>
              <select
                id="opt-side"
                className="input"
                value={draft.side}
                onChange={(e) => setDraft({ ...draft, side: e.target.value as '' | 'CALL' | 'PUT' })}
              >
                <option value="">همهٔ انواع</option>
                <option value="CALL">اختیار خرید</option>
                <option value="PUT">اختیار فروش</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="opt-listing">
                وضعیت معامله
              </label>
              <select
                id="opt-listing"
                className="input"
                value={draft.listing}
                onChange={(e) => setDraft({ ...draft, listing: e.target.value as 'all' | 'traded' })}
              >
                <option value="all">تمام نمادها</option>
                <option value="traded">فقط معامله‌شده</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="opt-premium">
                قیمت اختیار بیشتر از
              </label>
              <input
                id="opt-premium"
                className="input"
                dir="ltr"
                inputMode="decimal"
                value={draft.minPremium}
                onChange={(e) => setDraft({ ...draft, minPremium: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="opt-buy">
                حداقل حجم صف خرید
              </label>
              <input
                id="opt-buy"
                className="input"
                dir="ltr"
                inputMode="decimal"
                value={draft.minBuyQueue}
                onChange={(e) => setDraft({ ...draft, minBuyQueue: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="opt-sell">
                حداقل حجم صف فروش
              </label>
              <input
                id="opt-sell"
                className="input"
                dir="ltr"
                inputMode="decimal"
                value={draft.minSellQueue}
                onChange={(e) => setDraft({ ...draft, minSellQueue: e.target.value })}
              />
            </div>
            <div>
              <span className="label">روز مانده تا سررسید</span>
              <div className="flex items-center gap-2">
                <input
                  className="input"
                  dir="ltr"
                  inputMode="numeric"
                  aria-label="حداقل روز مانده"
                  placeholder="از"
                  value={draft.minDays}
                  onChange={(e) => setDraft({ ...draft, minDays: e.target.value })}
                />
                <span className="text-sm text-navy-800/50">تا</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="numeric"
                  aria-label="حداکثر روز مانده"
                  placeholder="تا"
                  value={draft.maxDays}
                  onChange={(e) => setDraft({ ...draft, maxDays: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-900/10 pt-4">
            <span className="text-sm text-navy-800/55">
              {items ? `${rows.length.toLocaleString('fa-IR')} نماد` : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setDraft(INITIAL_FILTERS);
                  setApplied(INITIAL_FILTERS);
                }}
              >
                پاک کردن فیلترها
              </button>
              <button type="submit" className="btn-primary">
                اعمال فیلتر
              </button>
            </div>
          </div>
        </form>
      )}

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
            {compact ? (
              <button type="button" className="btn-secondary" onClick={() => setVisible(rows.length)}>
                نمایش بیشتر ({(rows.length - shown.length).toLocaleString('fa-IR')} ردیف دیگر)
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={() => setVisible((count) => count + 40)}>
                نمایش {Math.min(40, rows.length - shown.length).toLocaleString('fa-IR')} ردیف دیگر
              </button>
            )}
          </div>
        )}
        {!items && loading && <p className="p-6 text-sm text-navy-800/60">در حال بارگذاری...</p>}
      </section>
    </>
  );
}
