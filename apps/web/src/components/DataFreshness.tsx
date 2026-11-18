'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Freshness = {
  stockPrices: string | null;
  goldUsd: string | null;
  iranNews: string | null;
  worldMarkets: string | null;
  macro: string | null;
  fundReportMonth: string | null;
  options: string | null;
};

type Key = keyof Freshness;

const LABEL_FA: Record<Key, string> = {
  stockPrices: 'قیمت بورس',
  goldUsd: 'طلا و دلار',
  iranNews: 'اخبار ایران',
  worldMarkets: 'اقتصاد دنیا',
  macro: 'کلان ایران',
  fundReportMonth: 'گزارش صندوق‌ها',
  options: 'اختیار معامله',
};

/** چند روز گذشته؛ بیش از این خاکستری نیست و رنگ هشدار می‌گیرد */
const STALE_DAYS: Partial<Record<Key, number>> = {
  stockPrices: 4,
  goldUsd: 3,
  iranNews: 3,
  worldMarkets: 4,
  options: 4,
  macro: 45,
};

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', month: 'long', day: 'numeric' });
}

function monthLabel(reportMonth: string) {
  const [y, m] = reportMonth.split('-').map(Number);
  const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  if (!y || !m) return reportMonth;
  return `${months[m - 1] ?? m} ${y.toLocaleString('fa-IR', { useGrouping: false })}`;
}

/** برچسب تازگی داده‌هایی که پیشنهاد و آنالیز سبد از آن‌ها استفاده می‌کنند */
export function DataFreshness({ keys }: { keys?: Key[] }) {
  const [data, setData] = useState<Freshness | null>(null);

  useEffect(() => {
    api<Freshness>('/market/freshness')
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return null;
  const shown = keys ?? (Object.keys(LABEL_FA) as Key[]);
  const now = Date.now();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-navy-800/55" aria-label="تازگی داده">
      <span>به‌روزرسانی داده:</span>
      {shown.map((key) => {
        const value = data[key];
        if (!value) {
          return (
            <span key={key} className="text-navy-800/35">
              {LABEL_FA[key]}: ندارد
            </span>
          );
        }
        if (key === 'fundReportMonth') {
          return (
            <span key={key}>
              {LABEL_FA[key]}: {monthLabel(value)}
            </span>
          );
        }
        const ageDays = (now - new Date(value).getTime()) / 86_400_000;
        const stale = STALE_DAYS[key] != null && ageDays > (STALE_DAYS[key] as number);
        return (
          <span key={key} className={stale ? 'text-amber-700' : undefined} title={stale ? 'این داده قدیمی است' : undefined}>
            {LABEL_FA[key]}: {dayLabel(value)}
          </span>
        );
      })}
    </div>
  );
}
