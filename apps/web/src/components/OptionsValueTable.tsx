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
  | 'totalCost'
  | 'costGap'
  | 'costGapPct'
  | 'buyQueue'
  | 'sellQueue'
  | 'daysLeft'
  | 'profit'
  | 'realProfit';

const COLUMNS: Array<{ key: SortKey; label: string; help?: string; fixed?: boolean }> = [
  { key: 'symbol', label: 'نماد', fixed: true },
  { key: 'side', label: 'نوع' },
  { key: 'underlying', label: 'دارایی پایه' },
  { key: 'underlyingPrice', label: 'قیمت پایه', help: 'آخرین قیمت ذخیره‌شدهٔ دارایی پایه' },
  { key: 'strike', label: 'اعمال', help: 'قیمت اعمال قرارداد' },
  { key: 'premium', label: 'قیمت اختیار', help: 'آخرین قیمت معاملهٔ خود اختیار (پرمیوم)' },
  {
    key: 'totalCost',
    label: 'مبلغ تمام شده',
    help: 'نقطهٔ سربه‌سر. اختیار خرید: اعمال + قیمت اختیار. اختیار فروش: اعمال − قیمت اختیار.',
  },
  {
    key: 'costGap',
    label: 'مبلغ تفاوت با دارایی پایه',
    help: 'مبلغ تمام شده − قیمت پایه. سبز یعنی همین حالا در سود: برای اختیار خرید منفی و برای اختیار فروش مثبت.',
  },
  { key: 'costGapPct', label: 'درصد تفاوت با دارایی پایه', help: 'مبلغ تفاوت ÷ قیمت پایه × ۱۰۰' },
  { key: 'buyQueue', label: 'حجم صف خرید' },
  { key: 'sellQueue', label: 'حجم صف فروش' },
  { key: 'daysLeft', label: 'روز مانده', help: 'روز تقویمی تا سررسید' },
  {
    key: 'profit',
    label: 'سود',
    help: 'سود هر واحد اگر همین حالا اعمال شود: ارزش ذاتی − قیمت اختیار. درصد نسبت به قیمت اختیار است.',
  },
  { key: 'realProfit', label: 'سود واقعی', help: 'همان سود پس از کسر تورم تا سررسید' },
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

/**
 * مبلغ تمام شده (نقطهٔ سربه‌سر):
 * اختیار خرید = اعمال + قیمت اختیار، اختیار فروش = اعمال − قیمت اختیار
 */
function totalCost(row: OptionsTableRow): number | null {
  const premium = rowNumber(row.premium);
  const strike = rowNumber(row.strike);
  if (premium == null || !(premium > 0) || strike == null) return null;
  return row.side === 'PUT' ? strike - premium : strike + premium;
}

/**
 * رنگ مبلغ و درصد تفاوت: سود خریدار سبز، زیان قرمز.
 * اختیار خرید وقتی سود می‌دهد که سربه‌سر زیر قیمت پایه باشد (تفاوت منفی)؛
 * اختیار فروش وقتی که سربه‌سر بالای قیمت پایه باشد (تفاوت مثبت).
 */
function gapClass(row: OptionsTableRow, gap: number): string | undefined {
  if (gap === 0) return undefined;
  const profitable = row.side === 'PUT' ? gap > 0 : gap < 0;
  return profitable ? 'text-emerald-700' : 'text-red-700';
}

/** مبلغ تفاوت با دارایی پایه = مبلغ تمام شده − قیمت پایه */
function costGap(row: OptionsTableRow): number | null {
  const total = totalCost(row);
  const underlying = rowNumber(row.underlyingPrice);
  if (total == null || underlying == null) return null;
  return total - underlying;
}

/** درصد تفاوت با دارایی پایه = مبلغ تفاوت با دارایی پایه ÷ قیمت پایه × ۱۰۰ */
function costGapPct(row: OptionsTableRow): number | null {
  const gap = costGap(row);
  const underlying = rowNumber(row.underlyingPrice);
  if (gap == null || underlying == null || !(underlying > 0)) return null;
  return (gap / underlying) * 100;
}

function formatQueue(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatNum(value);
}

const COLUMN_STORE_KEY = 'sabadyar_option_hidden_columns';

/** محتوای هر خانهٔ جدول؛ ترتیب ستون‌ها از COLUMNS می‌آید تا پنهان کردن ستون ساده بماند */
function cellContent(row: OptionsTableRow, key: SortKey): React.ReactNode {
  switch (key) {
    case 'symbol':
      return row.symbol;
    case 'side':
      return row.sideFa;
    case 'underlying':
      return row.underlyingSymbol;
    case 'underlyingPrice':
      return row.underlyingPrice == null ? '—' : formatNum(row.underlyingPrice);
    case 'strike':
      return formatNum(row.strike);
    case 'premium':
      return row.premium == null || !(row.premium > 0) ? '—' : formatNum(row.premium);
    case 'totalCost': {
      const total = totalCost(row);
      return total == null ? '—' : formatNum(total);
    }
    case 'costGap': {
      const gap = costGap(row);
      if (gap == null) return '—';
      return (
        <span dir="ltr" className={gapClass(row, gap)}>
          {formatNum(gap)}
        </span>
      );
    }
    case 'costGapPct': {
      const pctGap = costGapPct(row);
      if (pctGap == null) return '—';
      return (
        <span dir="ltr" className={gapClass(row, pctGap)}>
          {pctGap.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪
        </span>
      );
    }
    case 'buyQueue':
      return formatQueue(row.buyQueueVolume);
    case 'sellQueue':
      return formatQueue(row.sellQueueVolume);
    case 'daysLeft':
      return row.daysLeft == null ? '—' : Math.round(row.daysLeft).toLocaleString('fa-IR');
    case 'profit':
      if (row.profitRial == null || row.profitPct == null) return <span className="text-navy-800/45">—</span>;
      return (
        <>
          <div
            className={row.profitRial >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}
            title={`${row.profitPct.toLocaleString('fa-IR')}٪ نسبت به قیمت اختیار${
              row.contractSize != null ? ` · اندازهٔ قرارداد ${formatNum(row.contractSize)}` : ''
            }`}
          >
            {Math.round(row.profitRial).toLocaleString('fa-IR')}
          </div>
          <div className="text-[11px] leading-4 text-navy-800/55">
            {row.profitPct.toLocaleString('fa-IR', { maximumFractionDigits: 0 })}٪
          </div>
        </>
      );
    case 'realProfit':
      if (row.realProfitRial == null || row.realProfitPct == null) return <span className="text-navy-800/45">—</span>;
      return (
        <>
          <div className={row.realProfitRial >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>
            {Math.round(row.realProfitRial).toLocaleString('fa-IR')}
          </div>
          <div className="text-xs text-navy-800/55">
            {Math.round(row.realProfitPct).toLocaleString('fa-IR')}٪ پس از تورم{' '}
            {row.daysLeft == null ? '—' : Math.round(row.daysLeft).toLocaleString('fa-IR')} روز
          </div>
        </>
      );
    default:
      return null;
  }
}

function sortValue(row: OptionsTableRow, key: SortKey): string | number | null {
  if (key === 'symbol') return row.symbol;
  if (key === 'side') return row.sideFa;
  if (key === 'underlying') return row.underlyingSymbol;
  if (key === 'underlyingPrice') return row.underlyingPrice;
  if (key === 'strike') return row.strike;
  if (key === 'premium') return row.premium;
  if (key === 'totalCost') return totalCost(row);
  if (key === 'costGap') return costGap(row);
  if (key === 'costGapPct') return costGapPct(row);
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
  const [hidden, setHidden] = useState<Set<SortKey>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMN_STORE_KEY) ?? '[]') as SortKey[];
      if (Array.isArray(saved)) setHidden(new Set(saved));
    } catch {
      /* بدون حافظهٔ مرورگر همهٔ ستون‌ها دیده می‌شوند */
    }
  }, []);

  function toggleColumn(key: SortKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLUMN_STORE_KEY, JSON.stringify([...next]));
      } catch {
        /* فقط تا بارگذاری بعد می‌ماند */
      }
      return next;
    });
  }

  const columns = COLUMNS.filter((c) => !hidden.has(c.key));

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

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="text-xs text-navy-800/70 underline" onClick={() => setPickerOpen((v) => !v)}>
          {pickerOpen ? 'بستن انتخاب ستون‌ها' : `ستون‌ها${hidden.size ? ` (${hidden.size.toLocaleString('fa-IR')} پنهان)` : ''}`}
        </button>
      </div>
      {pickerOpen && (
        <div className="card flex flex-wrap gap-2 !py-3">
          {COLUMNS.filter((c) => !c.fixed).map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 rounded-full bg-navy-50 px-3 py-1 text-xs">
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-3 text-start font-medium${column.key === 'profit' ? ' w-20' : ''}`}
                  title={column.help}
                >
                  <button type="button" className="font-medium text-white" onClick={() => toggleSort(column.key)}>
                    {column.label}
                    {column.help ? <span className="ms-1 text-[10px] text-white/50">ⓘ</span> : null}
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
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={
                      column.key === 'profit'
                        ? 'w-20 px-2 py-2.5'
                        : column.key === 'symbol'
                          ? 'px-3 py-2.5 font-medium'
                          : 'px-3 py-2.5'
                    }
                  >
                    {cellContent(row, column.key)}
                  </td>
                ))}
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
