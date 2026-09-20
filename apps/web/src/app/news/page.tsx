'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { formatShamsiDate } from '@/lib/shamsi-date';

type NewsItem = {
  id: string;
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string | null;
  impactDirection?: string | null;
  relevanceScore?: number | null;
  sectorsFa?: string | null;
  xSourceHintFa?: string | null;
  category?: string | null;
  opportunityKind?: string | null;
  participateHowFa?: string | null;
  deadlineFa?: string | null;
  officialSourceFa?: string | null;
  isRetailActionable?: boolean | null;
};

type NewsBatch = {
  id: string;
  newsDateKey: string;
  summaryFa?: string | null;
  sourceNoteFa?: string | null;
  items: NewsItem[];
  createdAt: string;
};

type NewsListResponse = {
  todayKey: string;
  todayLabelFa: string;
  batches: NewsBatch[];
};

const DIRECTION_FA: Record<string, string> = {
  bullish: 'مثبت',
  bearish: 'منفی',
  neutral: 'خنثی',
  mixed: 'مختلط',
};

const DIRECTION_CLASS: Record<string, string> = {
  bullish: 'bg-emerald-100 text-emerald-800',
  bearish: 'bg-red-100 text-red-800',
  neutral: 'bg-navy-100 text-navy-800',
  mixed: 'bg-amber-100 text-amber-800',
};

const KIND_FA: Record<string, string> = {
  ipo: 'عرضه اولیه',
  auto_sale: 'ثبت‌نام خودرو',
  coin_auction: 'حراج سکه',
  fx_auction: 'حراج ارز',
  arbitrage: 'آربیتراژ',
  growth: 'بازار مستعد رشد',
  sukuk: 'اوراق / صکوک',
  housing: 'مسکن',
  fund: 'صندوق',
  deposit: 'گواهی سپرده',
  other: 'سایر فرصت‌ها',
};

function asSocialSource(text: string) {
  return text
    .replace(/شبکهٔ?\s*اجتماعی\s*X/gi, 'شبکه اجتماعی')
    .replace(/شبکهٔ?\s*X(\s*\(\s*توییتر\s*\))?/gi, 'شبکه اجتماعی')
    .replace(/فضای\s*X/gi, 'شبکه اجتماعی')
    .replace(/جستجوی\s*(زندهٔ?\s*)?X/gi, 'جستجوی شبکه اجتماعی')
    .replace(/\bTwitter\b/gi, 'شبکه اجتماعی')
    .replace(/توییتر/g, 'شبکه اجتماعی')
    .replace(/(^|[\s،,.؛:«»"])X(?=[\s،,.؛:»"]|$)/g, '$1شبکه اجتماعی');
}

function formatDateKey(key: string) {
  return formatShamsiDate(key);
}

function isOpportunity(item: NewsItem) {
  return item.category === 'opportunity' || Boolean(item.isRetailActionable);
}

function NewsCard({ item }: { item: NewsItem }) {
  const opp = isOpportunity(item);
  return (
    <article className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold">{asSocialSource(item.titleFa)}</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {opp && (
            <span className="rounded bg-gold-400/25 px-2 py-0.5 text-gold-500">
              {KIND_FA[item.opportunityKind ?? ''] ?? 'فرصت سرمایه‌گذاری'}
            </span>
          )}
          {item.impactDirection && (
            <span className={`rounded px-2 py-0.5 ${DIRECTION_CLASS[item.impactDirection] ?? 'bg-navy-50'}`}>
              {DIRECTION_FA[item.impactDirection] ?? item.impactDirection}
            </span>
          )}
          {item.relevanceScore != null && (
            <span className="rounded bg-navy-50 px-2 py-0.5">اهمیت: {formatNum(item.relevanceScore)}/۱۰</span>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm leading-7 text-navy-800/80">{asSocialSource(item.summaryFa)}</p>
      {item.marketImpactFa && (
        <p className="mt-2 text-sm leading-7">
          <strong>{opp ? 'چرا فرصت است:' : 'اثر محتمل روی اقتصاد ایران:'}</strong>{' '}
          {asSocialSource(item.marketImpactFa)}
        </p>
      )}
      {item.participateHowFa && (
        <p className="mt-2 text-sm leading-7">
          <strong>چطور شرکت کنید:</strong> {item.participateHowFa}
        </p>
      )}
      {item.deadlineFa && (
        <p className="mt-1 text-sm leading-7">
          <strong>مهلت:</strong> {item.deadlineFa}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-navy-800/55">
        {item.xSourceHintFa && <span>{asSocialSource(item.xSourceHintFa)}</span>}
        {item.officialSourceFa && <span>منبع رسمی: {item.officialSourceFa}</span>}
        {item.sectorsFa && <span>بخش‌ها: {item.sectorsFa}</span>}
      </div>
    </article>
  );
}

export default function NewsPage() {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<NewsListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const isAdmin = role === 'ADMIN';

  async function load() {
    const res = await api<NewsListResponse>('/news?days=21');
    setData(res);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const cached = getUserRole();
    if (cached) setRole(cached);
    api<{ role?: UserRole }>('/users/me')
      .then((u) => {
        if (u.role) {
          setUserRole(u.role);
          setRole(u.role);
        }
      })
      .catch(() => undefined);
    load().catch(() => undefined);
  }, [router]);

  async function refresh() {
    setLoading(true);
    try {
      await api('/news/refresh', { method: 'POST' });
      await load();
      toast.success('اخبار و فرصت‌های امروز به‌روزرسانی و ذخیره شد.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const todayBatch = data?.batches.find((b) => b.newsDateKey === data.todayKey);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">اخبار اقتصادی ایران</h1>
          {data?.todayKey && (
            <p className="mt-1 text-sm text-navy-800/50">امروز: {formatShamsiDate(data.todayKey)}</p>
          )}
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={refresh} disabled={loading}>
            {loading ? 'در حال جستجوی شبکه اجتماعی...' : 'به‌روزرسانی اخبار'}
          </button>
        )}
      </div>

      {todayBatch?.summaryFa && (
        <section className="card">
          <h2 className="text-lg font-semibold">خلاصه امروز</h2>
          <p className="mt-2 whitespace-pre-line leading-7 text-navy-800/80">
            {asSocialSource(todayBatch.summaryFa)}
          </p>
        </section>
      )}

      {!data && <p className="text-navy-800/60">در حال بارگذاری...</p>}

      {data && data.batches.length === 0 && (
        <p className="text-sm text-navy-800/60">
          {isAdmin
            ? 'هنوز خبری ثبت نشده. راس ۸ صبح خودکار می‌آید؛ یا دکمه «به‌روزرسانی اخبار» را بزنید.'
            : 'هنوز خبری در سیستم ثبت نشده است. جمع‌آوری بعدی راس ساعت ۸ صبح است.'}
        </p>
      )}

      {data?.batches.map((batch) => {
        const macros = batch.items.filter((i) => !isOpportunity(i)).slice(0, 7);
        const opportunities = batch.items.filter(isOpportunity).slice(0, 3);
        return (
          <section key={batch.id} className="space-y-4">
            <h2 className="text-lg font-semibold">{formatDateKey(batch.newsDateKey)}</h2>
            {batch.summaryFa && batch.newsDateKey !== data.todayKey && (
              <p className="whitespace-pre-line text-sm leading-7 text-navy-800/70">
                {asSocialSource(batch.summaryFa)}
              </p>
            )}

            {macros.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-navy-800/70">اثرگذار بر اقتصاد ایران</h3>
                {macros.map((item) => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
            )}

            {opportunities.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-navy-800/70">فرصت‌های سرمایه‌گذاری</h3>
                {opportunities.map((item) => (
                  <NewsCard key={item.id} item={item} />
                ))}
              </div>
            )}

            {macros.length === 0 && opportunities.length === 0 && (
              <p className="text-sm text-navy-800/50">خبری برای این روز ثبت نشده.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
