'use client';

import { useEffect, useState } from 'react';
import { api, formatNum, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { WaitingOverlay } from '@/components/WaitingOverlay';
import { TehranMarketChat } from '@/components/TehranMarketChat';
import { formatShamsiDateTime } from '@/lib/shamsi-date';

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

type QuotesPage = {
  items: Quote[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  updatedAt?: string | null;
};

type IngestResult = {
  upserted: number;
  tradeDate: string;
  source?: string;
  dayCount?: number;
  days?: Array<{ tradeDate: string; upserted: number }>;
};

type MarketIndex = {
  key: 'total' | 'equalWeight' | string;
  nameFa: string;
  lastValue: number | null;
  changePct: number | null;
  history: Array<{ tradeDate: string; value: number }>;
};

const PAGE_SIZE = 20;

const ASSET_FA: Record<string, string> = {
  STOCK: 'سهام',
  GOLD_ETF: 'طلا',
  OPTION: 'اختیار',
  DEPOSIT: 'سپرده',
  FUND: 'صندوق',
  CASH: 'نقد',
  INDEX: 'شاخص',
};

function formatIndexValue(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatIndexPct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function IndexSparkline({ index }: { index: MarketIndex }) {
  const values = index.history.map((h) => h.value).filter((v) => v > 0);
  const up = (index.changePct ?? 0) >= 0;
  const stroke = up ? '#15803d' : '#b91c1c';
  const fill = up ? 'rgba(21,128,61,0.12)' : 'rgba(185,28,28,0.10)';
  const pct = formatIndexPct(index.changePct);

  let path = '';
  let area = '';
  if (values.length >= 2) {
    const w = 120;
    const h = 36;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = 2 + (1 - (v - min) / range) * (h - 4);
      return { x, y };
    });
    path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    area = `${path} L ${pts[pts.length - 1].x.toFixed(1)} ${h} L ${pts[0].x.toFixed(1)} ${h} Z`;
  }

  return (
    <div className="flex shrink-0 items-center gap-3 rounded-xl border border-navy-900/10 bg-white px-3 py-2 shadow-sm">
      <div className="shrink-0">
        <div className="text-[11px] text-navy-800/55">{index.nameFa}</div>
        <div className="mt-0.5 text-base font-semibold tabular-nums leading-6 text-navy-900">
          {formatIndexValue(index.lastValue)}
        </div>
        {pct && (
          <div className={clsx('text-[11px] font-medium', up ? 'text-emerald-700' : 'text-red-700')}>
            {pct}
          </div>
        )}
      </div>
      <div className="hidden w-[7.5rem] shrink-0 sm:block">
        {values.length >= 2 ? (
          <svg viewBox="0 0 120 36" className="h-9 w-full" aria-hidden>
            <path d={area} fill={fill} />
            <path d={path} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="flex h-9 items-center justify-center text-[10px] text-navy-800/35">بدون روند</div>
        )}
      </div>
    </div>
  );
}

export default function MarketPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [q, setQ] = useState('');
  const [assetType, setAssetType] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load(nextPage = page) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (assetType) params.set('assetType', assetType);
    params.set('take', String(PAGE_SIZE));
    params.set('page', String(nextPage));
    const data = await api<QuotesPage>(`/market/quotes?${params}`);
    setQuotes(data.items ?? []);
    setTotal(data.total ?? 0);
    setTotalPages(data.totalPages ?? 1);
    setPage(data.page ?? nextPage);
    setUpdatedAt(data.updatedAt ?? null);
  }

  async function loadIndices() {
    try {
      const data = await api<MarketIndex[]>('/market/indices?days=60');
      setIndices(data);
    } catch {
      setIndices([]);
    }
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
    load(1).catch(() => undefined);
    loadIndices().catch(() => undefined);
  }, [router]);

  async function applyFilter() {
    setPage(1);
    await load(1);
  }

  async function goToPage(next: number) {
    const clamped = Math.min(Math.max(next, 1), totalPages);
    setPage(clamped);
    await load(clamped);
  }

  async function ingest() {
    setLoading(true);
    setMsg('');
    try {
      const res = await api<IngestResult>('/market/ingest', { method: 'POST' });
      const src = res.source ? ` (منبع: ${res.source})` : '';
      const days =
        res.dayCount && res.dayCount > 1
          ? ` — ${res.dayCount.toLocaleString('fa-IR')} روز به‌روزرسانی شد`
          : '';
      setMsg(
        `به‌روزرسانی انجام شد: ${res.upserted.toLocaleString('fa-IR')} ردیف${days}${src}`,
      );
      await Promise.all([load(1), loadIndices()]);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const totalIndex = indices.find((i) => i.key === 'total');
  const equalIndex = indices.find((i) => i.key === 'equalWeight');
  const updatedLabel = updatedAt ? formatShamsiDateTime(updatedAt) : null;

  return (
    <div className="space-y-6">
      {loading && (
        <WaitingOverlay
          title="در حال دریافت از TSETMC"
          description="قیمت‌ها، EPS، P/E و شاخص‌های کل و هم‌وزن در حال به‌روزرسانی است. این کار ممکن است چند دقیقه طول بکشد."
          steps={[
            'اتصال به منبع داده بازار...',
            'دریافت فهرست نمادها...',
            'ذخیره قیمت و حجم معاملات...',
            'بروزرسانی EPS و P/E...',
            'خواندن شاخص کل و هم‌وزن...',
          ]}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">بازار سهام تهران</h1>
          <p className="mt-2 text-navy-800/70">قیمت، EPS و P/E ذخیره‌شده</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isAdmin && (
            <button className="btn-primary" onClick={ingest} disabled={loading}>
              {loading ? 'در حال دریافت...' : 'به‌روزرسانی از TSETMC'}
            </button>
          )}
          <p className="text-xs text-navy-800/50">
            آخرین به‌روزرسانی: {updatedLabel ?? 'هنوز انجام نشده'}
          </p>
        </div>
      </div>
      {(totalIndex || equalIndex) && (
        <div className="flex flex-wrap items-center gap-2">
          {totalIndex && <IndexSparkline index={totalIndex} />}
          {equalIndex && <IndexSparkline index={equalIndex} />}
        </div>
      )}

      {msg && <p className="text-sm text-navy-800/80">{msg}</p>}

      <TehranMarketChat />

      <div className="card flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="جستجوی نماد..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter().catch(() => undefined);
          }}
        />
        <select className="input max-w-xs" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
          <option value="">همه دارایی‌ها</option>
          <option value="STOCK">سهام</option>
          <option value="GOLD_ETF">طلا</option>
          <option value="OPTION">اختیار</option>
          <option value="DEPOSIT">سپرده</option>
        </select>
        <button className="btn-secondary" onClick={() => applyFilter()}>
          اعمال فیلتر
        </button>
        {total > 0 && (
          <span className="self-center text-sm text-navy-800/55">
            {total.toLocaleString('fa-IR')} نماد
          </span>
        )}
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
              <tr
                key={row.id}
                className="cursor-pointer border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40 hover:bg-gold-400/10"
                onClick={() => router.push(`/market/${row.id}`)}
              >
                <td className="px-4 py-2.5 font-medium text-navy-900 underline-offset-2 hover:underline">
                  {row.symbol}
                </td>
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
          <p className="p-6 text-sm text-navy-800/60">
            {isAdmin
              ? 'داده‌ای نیست. دکمه به‌روزرسانی را بزنید.'
              : 'داده‌ای نیست. مدیر سیستم باید بازار را به‌روزرسانی کند.'}
          </p>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            قبلی
          </button>
          <span className="text-sm text-navy-800/70">
            صفحه {page.toLocaleString('fa-IR')} از {totalPages.toLocaleString('fa-IR')}
          </span>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}
