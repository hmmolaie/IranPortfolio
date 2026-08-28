'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';

type NewsItem = {
  id: string;
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string | null;
  impactDirection?: string | null;
  relevanceScore?: number | null;
  sectorsFa?: string | null;
  xSourceHintFa?: string | null;
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

function formatDateKey(key: string) {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(key + 'T12:00:00'));
  } catch {
    return key;
  }
}

export default function NewsPage() {
  const router = useRouter();
  const [data, setData] = useState<NewsListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    const res = await api<NewsListResponse>('/news?days=21');
    setData(res);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => undefined);
  }, [router]);

  async function refresh() {
    setLoading(true);
    setMsg('');
    try {
      await api('/news/refresh', { method: 'POST' });
      await load();
      setMsg('اخبار امروز به‌روزرسانی و ذخیره شد.');
    } catch (e) {
      setMsg((e as Error).message);
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
          <p className="mt-2 text-navy-800/70">
            با زدن «به‌روزرسانی اخبار»، از مدل زبانی تنظیم‌شده در سیستم پرسیده می‌شود اخبار اقتصادی
            امروز در X را مرور کند؛ نتیجه اینجا ذخیره و در پیشنهاد سبد لحاظ می‌شود.
          </p>
          {data?.todayLabelFa && (
            <p className="mt-1 text-sm text-navy-800/50">امروز: {data.todayLabelFa}</p>
          )}
        </div>
        <button className="btn-primary" onClick={refresh} disabled={loading}>
          {loading ? 'در حال تحلیل...' : 'به‌روزرسانی اخبار'}
        </button>
      </div>

      {msg && <p className="text-sm text-navy-800">{msg}</p>}

      <p className="rounded-lg bg-navy-50 px-4 py-3 text-sm text-navy-800/75">
        اتصال مستقیم به X در سبدیار نیست؛ درخواست به همان LLM تنظیم‌شده در{' '}
        <strong>تنظیمات</strong> ارسال می‌شود. متن پرامپت را از{' '}
        <strong>پرامپت‌های LLM → به‌روزرسانی اخبار اقتصادی</strong> می‌توانید تغییر دهید.
      </p>

      {todayBatch?.summaryFa && (
        <section className="card">
          <h2 className="text-lg font-semibold">خلاصه امروز</h2>
          <p className="mt-2 leading-7 text-navy-800/80">{todayBatch.summaryFa}</p>
          {todayBatch.sourceNoteFa && (
            <p className="mt-2 text-xs text-navy-800/50">منبع: {todayBatch.sourceNoteFa}</p>
          )}
        </section>
      )}

      {!data && <p className="text-navy-800/60">در حال بارگذاری...</p>}

      {data && data.batches.length === 0 && (
        <p className="text-sm text-navy-800/60">
          هنوز خبری ثبت نشده. دکمه «به‌روزرسانی اخبار» را بزنید.
        </p>
      )}

      {data?.batches.map((batch) => (
        <section key={batch.id} className="space-y-4">
          <h2 className="text-lg font-semibold">{formatDateKey(batch.newsDateKey)}</h2>
          {batch.summaryFa && batch.newsDateKey !== data.todayKey && (
            <p className="text-sm leading-7 text-navy-800/70">{batch.summaryFa}</p>
          )}
          {batch.items.length === 0 ? (
            <p className="text-sm text-navy-800/50">خبری برای این روز ثبت نشده.</p>
          ) : (
            <div className="space-y-3">
              {batch.items.map((item) => (
                <article key={item.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-base font-semibold">{item.titleFa}</h3>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {item.impactDirection && (
                        <span
                          className={`rounded px-2 py-0.5 ${DIRECTION_CLASS[item.impactDirection] ?? 'bg-navy-50'}`}
                        >
                          {DIRECTION_FA[item.impactDirection] ?? item.impactDirection}
                        </span>
                      )}
                      {item.relevanceScore != null && (
                        <span className="rounded bg-navy-50 px-2 py-0.5">
                          اهمیت: {formatNum(item.relevanceScore)}/۱۰
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-navy-800/80">{item.summaryFa}</p>
                  {item.marketImpactFa && (
                    <p className="mt-2 text-sm leading-7">
                      <strong>اثر احتمالی فردا:</strong> {item.marketImpactFa}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-navy-800/55">
                    {item.sectorsFa && <span>بخش‌ها: {item.sectorsFa}</span>}
                    {item.xSourceHintFa && <span>X: {item.xSourceHintFa}</span>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
