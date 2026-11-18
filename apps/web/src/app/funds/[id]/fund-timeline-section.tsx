'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatNum } from '@/lib/api';

type TimelineReport = {
  id: string;
  reportMonth: string;
  reportYear?: number | null;
  reportMonthNum?: number | null;
  rating?: number | null;
};

type TimelineInsight = {
  id: string;
  fromMonth?: string | null;
  toMonth?: string | null;
  summaryFa: string;
  strategyChangeFa?: string | null;
  llmReasoningFa?: string | null;
  createdAt: string;
};

const MONTHS_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

function monthLabel(r: TimelineReport) {
  if (r.reportYear && r.reportMonthNum) {
    return `${MONTHS_FA[r.reportMonthNum - 1] ?? r.reportMonthNum} ${r.reportYear.toLocaleString('fa-IR', { useGrouping: false })}`;
  }
  return r.reportMonth;
}

/**
 * عملکرد صندوق در طول زمان: تحلیل‌های ماه‌به‌ماه همین صندوق.
 * تحلیل دستی ندارد؛ با آنالیز هر گزارش، ماه‌هایی که با ماه قبلشان مقایسه نشده‌اند خودکار تحلیل می‌شوند.
 */
export function FundTimelineSection({ fundId }: { fundId: string }) {
  const [reports, setReports] = useState<TimelineReport[]>([]);
  const [insights, setInsights] = useState<TimelineInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  /** پیش‌فرض فقط تحلیل آخرین ماه؛ «مشاهده گزارش ماه قبل» یکی‌یکی ماه‌های قبل را باز می‌کند */
  const [shownCount, setShownCount] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{
        reports: TimelineReport[];
        insights: TimelineInsight[];
      }>(`/funds/timeline/${fundId}`);
      setReports(data.reports ?? []);
      setInsights(data.insights ?? []);
      setShownCount(1);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">عملکرد صندوق در طول زمان</h2>
        <p className="mt-1 text-sm text-navy-800/60">
          تحلیل تغییر استراتژی مدیر صندوق از مقایسهٔ گزارش هر ماه با ماه قبل؛ با آنالیز هر گزارش خودکار ساخته
          می‌شود.
        </p>
      </div>

      {msg && <p className="text-sm text-red-700">{msg}</p>}

      {loading ? (
        <p className="text-sm text-navy-800/60">در حال بارگذاری...</p>
      ) : (
        <>
          {reports.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reports.map((r) => (
                <span key={r.id} className="rounded-full bg-navy-50 px-3 py-1 text-xs text-navy-800">
                  {monthLabel(r)}
                  {r.rating != null && ` · امتیاز ${formatNum(r.rating)}`}
                </span>
              ))}
            </div>
          )}

          {insights.length === 0 ? (
            <p className="text-sm text-navy-800/50">
              {reports.length < 2
                ? 'حداقل دو گزارش ماهانه برای تحلیل مقایسه‌ای لازم است.'
                : 'هنوز تحلیلی نیست؛ برای دو ماه پشت‌سرهم گزارش آنالیزشده لازم است و بعد از آنالیز خودکار ساخته می‌شود.'}
            </p>
          ) : (
            <div className="space-y-4">
              {insights.slice(0, shownCount).map((ins, i, shown) => (
                <article key={ins.id} className="rounded-lg border border-navy-900/10 p-4">
                  {(ins.fromMonth || ins.toMonth) && (
                    <p className="text-xs text-navy-800/50">
                      {ins.fromMonth} → {ins.toMonth}
                    </p>
                  )}
                  <p className="mt-1 leading-7">{ins.summaryFa}</p>
                  {ins.strategyChangeFa && (
                    <p className="mt-2 text-sm text-navy-800/75">
                      <strong>تغییر استراتژی:</strong> {ins.strategyChangeFa}
                    </p>
                  )}
                  {ins.llmReasoningFa && (
                    <p className="mt-2 text-sm leading-7 text-navy-800/70">
                      <strong>تحلیل مدیر:</strong> {ins.llmReasoningFa}
                    </p>
                  )}
                  {i === shown.length - 1 && shownCount < insights.length && (
                    <div className="mt-3 border-t border-navy-900/10 pt-3">
                      <button
                        type="button"
                        className="text-sm font-medium text-gold-700 hover:underline"
                        onClick={() => setShownCount((c) => c + 1)}
                      >
                        مشاهده گزارش ماه قبل
                        {insights[shownCount]?.toMonth ? ` (${insights[shownCount].toMonth})` : ''}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
