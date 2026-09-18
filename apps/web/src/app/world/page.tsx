'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, formatNum, getToken } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { WaitingOverlay } from '@/components/WaitingOverlay';

type WorldMarket = {
  id: string;
  code: string;
  titleFa: string;
  title: string;
  baseCode: string;
  baseTitleFa: string;
  baseImageUrl?: string | null;
  baseColor?: string | null;
  quoteCode: string;
  quoteTitleFa: string;
  price: string;
  priceNum?: number | null;
  changePct?: number | null;
  high24h?: string | null;
  low24h?: string | null;
  volume24h?: string | null;
  volumeNum?: number | null;
  marketCap?: string | null;
  tradable: boolean;
  suspended: boolean;
  comingSoon: boolean;
  tagsFa?: string | null;
  yahooSymbol?: string | null;
  yahooPriceNum?: number | null;
  diffAbs?: number | null;
  diffPct?: number | null;
};

type QuoteStat = { code: string; count: number; titleFa: string };

type WorldList = {
  fetchedAt: string | null;
  dateLabelFa: string | null;
  symbolCount: number;
  sourceUrl: string;
  quotes: QuoteStat[];
  markets: WorldMarket[];
};

type QuoteFilter = 'ALL' | string;
type SortKey = 'volume' | 'gain' | 'loss' | 'name';

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatCompactFa(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  const body =
    abs >= 1e12
      ? `${formatNum(abs / 1e12)} هزار میلیارد`
      : abs >= 1e9
        ? `${formatNum(abs / 1e9)} میلیارد`
        : abs >= 1e6
          ? `${formatNum(abs / 1e6)} میلیون`
          : formatNum(abs);
  return sign + body;
}

function formatPrice(price: string, quoteCode: string) {
  const n = toNum(price);
  if (n == null) return '—';
  if (quoteCode === 'IRT') {
    return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n))} تومان`;
  }
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return `${new Intl.NumberFormat('fa-IR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n)} ${quoteCode === 'USDT' ? 'تتر' : quoteCode}`;
}

function formatChange(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function coinColor(hex?: string | null) {
  if (!hex) return '#a8893e';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

function MarketCard({ m, featured }: { m: WorldMarket; featured?: boolean }) {
  const change = m.changePct ?? null;
  const up = (change ?? 0) >= 0;
  const pct = formatChange(change);
  const [imgOk, setImgOk] = useState(Boolean(m.baseImageUrl));

  return (
    <article
      className={clsx(
        'relative overflow-hidden rounded-2xl border border-navy-900/10 bg-white/95 shadow-soft',
        featured ? 'p-5' : 'p-4',
      )}
    >
      <span
        className="absolute inset-y-0 start-0 w-1.5"
        style={{ backgroundColor: coinColor(m.baseColor) }}
        aria-hidden
      />
      <div className="flex items-start gap-3 ps-2">
        <div
          className={clsx(
            'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy-50',
            featured ? 'h-12 w-12' : 'h-10 w-10',
          )}
        >
          {imgOk && m.baseImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.baseImageUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setImgOk(false)}
            />
          ) : (
            <span className="text-[10px] font-bold text-navy-800/70">{m.baseCode.slice(0, 4)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={clsx('truncate font-semibold text-navy-900', featured ? 'text-base' : 'text-sm')}>
              {m.baseTitleFa || m.titleFa}
            </h3>
            <span className="rounded-full bg-navy-50 px-2 py-0.5 font-mono text-[10px] text-navy-800/60" dir="ltr">
              {m.code}
            </span>
          </div>
          <p className={clsx('mt-1 font-semibold tabular-nums text-navy-900', featured ? 'text-xl' : 'text-base')}>
            {formatPrice(m.price, m.quoteCode)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {pct && (
              <span
                className={clsx(
                  'rounded-full px-2 py-0.5 font-medium',
                  up ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
                )}
              >
                {up ? '▲' : '▼'} {pct}
              </span>
            )}
            <span className="text-navy-800/50">حجم ۲۴س {formatCompactFa(m.volumeNum ?? toNum(m.volume24h))}</span>
          </div>
          {(m.high24h || m.low24h) && (
            <p className="mt-2 text-[11px] text-navy-800/45">
              کف {formatPrice(m.low24h || '0', m.quoteCode)} · سقف {formatPrice(m.high24h || '0', m.quoteCode)}
            </p>
          )}
          {m.tagsFa && featured && (
            <p className="mt-2 truncate text-[11px] text-navy-800/45">{m.tagsFa}</p>
          )}
          {m.yahooPriceNum != null && m.diffPct != null && (
            <div className="mt-3 rounded-xl bg-navy-50/80 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-navy-800/70">اختلاف با بازار جهانی</p>
              <p className="mt-0.5 text-[11px] text-navy-800/50">
                یاهو فایننس: {formatPrice(String(m.yahooPriceNum), m.quoteCode)}
              </p>
              <p
                className={clsx(
                  'mt-0.5 text-xs font-medium tabular-nums',
                  (m.diffPct ?? 0) >= 0 ? 'text-amber-800' : 'text-emerald-800',
                )}
              >
                {(m.diffPct ?? 0) >= 0 ? '+' : ''}
                {(m.diffPct ?? 0).toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪
                {m.diffAbs != null ? ` · ${formatPrice(String(m.diffAbs), m.quoteCode)}` : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function WorldEconomyPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<WorldList | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [quote, setQuote] = useState<QuoteFilter>('ALL');
  const [sort, setSort] = useState<SortKey>('volume');
  const [visible, setVisible] = useState(48);

  async function load() {
    const res = await api<WorldList>('/world-markets');
    setData(res);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ role?: string }>('/users/me')
      .then((u) => {
        if (u.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
        return load();
      })
      .catch(() => router.replace('/'))
      .finally(() => setLoading(false));
  }, [router]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api<WorldList>('/world-markets/refresh', { method: 'POST' });
      setData(res);
      toast.success(`${res.symbolCount.toLocaleString('fa-IR')} نماد جایگزین شد.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = data?.markets ?? [];
    if (quote !== 'ALL') rows = rows.filter((m) => m.quoteCode === quote);
    if (q) {
      rows = rows.filter((m) =>
        [m.code, m.title, m.titleFa, m.baseCode, m.baseTitleFa, m.tagsFa]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q)),
      );
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === 'name') return a.titleFa.localeCompare(b.titleFa, 'fa');
      if (sort === 'gain') return (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity);
      if (sort === 'loss') return (a.changePct ?? Infinity) - (b.changePct ?? Infinity);
      return (b.volumeNum ?? 0) - (a.volumeNum ?? 0);
    });
    return copy;
  }, [data, query, quote, sort]);

  useEffect(() => {
    setVisible(48);
  }, [query, quote, sort]);

  const gainers = useMemo(
    () =>
      [...(data?.markets ?? [])]
        .filter((m) => m.changePct != null)
        .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
        .slice(0, 4),
    [data],
  );
  const losers = useMemo(
    () =>
      [...(data?.markets ?? [])]
        .filter((m) => m.changePct != null)
        .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
        .slice(0, 4),
    [data],
  );
  const featured = filtered.slice(0, 6);
  const showFeatured = featured.length > 0 && quote === 'ALL' && !query && sort === 'volume';
  const gridItems = showFeatured ? filtered.slice(6) : filtered;
  const shown = gridItems.slice(0, visible);

  const fetchedLabel = data?.fetchedAt
    ? new Intl.DateTimeFormat('fa-IR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Tehran',
      }).format(new Date(data.fetchedAt))
    : 'هنوز همگام نشده';

  if (loading) {
    return <p className="text-navy-800/60">در حال بارگذاری...</p>;
  }

  return (
    <div className="space-y-8">
      {refreshing && (
        <WaitingOverlay
          title="در حال به‌روزرسانی اقتصاد دنیا"
          description="نمادها از بیت‌پین گرفته می‌شود و قیمت رمزارز با یاهو فایننس مقایسه می‌گردد."
          steps={[
            'دریافت فهرست بازارها از بیت‌پین',
            'ذخیره آخرین قیمت‌ها',
            'خواندن قیمت جهانی از یاهو فایننس',
            'محاسبه اختلاف با بازار جهانی',
          ]}
        />
      )}

      <section className="overflow-hidden rounded-3xl bg-navy-900 text-white shadow-soft">
        <div className="relative px-6 py-8 sm:px-8">
          <div
            className="pointer-events-none absolute -start-10 -top-16 h-48 w-48 rounded-full bg-gold-400/20 blur-3xl"
            aria-hidden
          />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-wide text-gold-400">بازار جهانی رمزارز</p>
              <h1 className="mt-1 text-3xl font-bold">اقتصاد دنیا</h1>
              <p className="mt-2 max-w-xl text-sm leading-7 text-white/70">
                هر روز راس ۷ صبح تهران همهٔ نمادهای بیت‌پین ذخیره می‌شوند و مبلغ رمزارز با یاهو فایننس
                مقایسه می‌گردد.
              </p>
            </div>
            <button className="btn-primary bg-gold-400 text-navy-900 hover:bg-gold-500" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی فوری'}
            </button>
          </div>
          <div className="relative mt-6 grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl bg-white/10 px-4 py-3">
              <div className="text-xs text-white/55">تعداد نماد</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {(data?.symbolCount ?? 0).toLocaleString('fa-IR')}
              </div>
            </div>
            {(data?.quotes ?? []).slice(0, 2).map((q) => (
              <div key={q.code} className="rounded-2xl bg-white/10 px-4 py-3">
                <div className="text-xs text-white/55">بازار {q.titleFa}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{q.count.toLocaleString('fa-IR')}</div>
              </div>
            ))}
            <div className="rounded-2xl bg-white/10 px-4 py-3">
              <div className="text-xs text-white/55">آخرین ذخیره</div>
              <div className="mt-1 text-sm font-medium leading-6">{fetchedLabel}</div>
            </div>
          </div>
        </div>
      </section>

      {gainers.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <h2 className="text-sm font-semibold text-emerald-800">بیشترین رشد</h2>
            <ul className="mt-3 divide-y divide-navy-900/8">
              {gainers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate text-sm">{m.baseTitleFa}</span>
                  <span className="shrink-0 text-sm font-medium text-emerald-800">{formatChange(m.changePct)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="text-sm font-semibold text-red-800">بیشترین افت</h2>
            <ul className="mt-3 divide-y divide-navy-900/8">
              {losers.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="truncate text-sm">{m.baseTitleFa}</span>
                  <span className="shrink-0 text-sm font-medium text-red-800">{formatChange(m.changePct)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="label">جستجو</label>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="نام یا نماد، مثلاً بیت کوین یا BTC"
          />
        </div>
        <div>
          <label className="label">بازار</label>
          <select className="input min-w-[8rem]" value={quote} onChange={(e) => setQuote(e.target.value)}>
            <option value="ALL">همه</option>
            {(data?.quotes ?? []).map((q) => (
              <option key={q.code} value={q.code}>
                {q.titleFa}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">چینش</label>
          <select className="input min-w-[9rem]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="volume">حجم معاملات</option>
            <option value="gain">بیشترین رشد</option>
            <option value="loss">بیشترین افت</option>
            <option value="name">نام</option>
          </select>
        </div>
      </div>

      {(!data || data.markets.length === 0) && (
        <p className="rounded-2xl border border-dashed border-navy-900/15 bg-white/70 px-4 py-8 text-center text-sm text-navy-800/60">
          هنوز نمادی ذخیره نشده. دکمهٔ «به‌روزرسانی فوری» را بزنید.
        </p>
      )}

      {showFeatured && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">پرحجم‌ترین‌ها</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((m) => (
              <MarketCard key={`f-${m.id}`} m={m} featured />
            ))}
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            همهٔ نمادها
            <span className="ms-2 text-sm font-normal text-navy-800/50">
              {filtered.length.toLocaleString('fa-IR')} مورد
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
          {visible < gridItems.length && (
            <div className="flex justify-center pt-2">
              <button className="btn-secondary" onClick={() => setVisible((v) => v + 48)}>
                نمایش نمادهای بیشتر
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
