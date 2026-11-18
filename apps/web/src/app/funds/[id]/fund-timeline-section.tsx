'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, formatNum } from '@/lib/api';
import { WaitingOverlay } from '@/components/WaitingOverlay';

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

/** دکمهٔ تحلیل ماه‌به‌ماه: برای هر صندوق و ماه فقط یک‌بار */
type TimelineAnalyzeState = {
  canAnalyze: boolean;
  reasonFa: string | null;
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

const ANALYZE_STEPS = [
  'جمع‌آوری گزارش‌های ماهانه...',
  'مقایسه ترکیب سبدها...',
  'تحلیل تغییر استراتژی با AI...',
  'ثبت بینش ماه‌به‌ماه...',
];

function monthLabel(r: TimelineReport) {
  if (r.reportYear && r.reportMonthNum) {
    return `${MONTHS_FA[r.reportMonthNum - 1] ?? r.reportMonthNum} ${r.reportYear.toLocaleString('fa-IR', { useGrouping: false })}`;
  }
  return r.reportMonth;
}

/** عملکرد صندوق در طول زمان: تحلیل ماه‌به‌ماه با AI برای همین صندوق */
export function FundTimelineSection({ fundId }: { fundId: string }) {
  const [reports, setReports] = useState<TimelineReport[]>([]);
  const [insights, setInsights] = useState<TimelineInsight[]>([]);
  const [analyzeState, setAnalyzeState] = useState<TimelineAnalyzeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{
        reports: TimelineReport[];
        insights: TimelineInsight[];
        analyze?: TimelineAnalyzeState;
      }>(`/funds/timeline/${fundId}`);
      setReports(data.reports ?? []);
      setInsights(data.insights ?? []);
      setAnalyzeState(data.analyze ?? null);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fundId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function onAnalyze() {
    setAnalyzing(true);
    setMsg('');
    try {
      await api(`/funds/timeline/${fundId}/analyze`, { method: 'POST' });
      setMsg('تحلیل عملکرد ماه‌به‌ماه انجام شد.');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">عملکرد صندوق در طول زمان</h2>
          <p className="mt-1 text-sm text-navy-800/60">
            تحلیل تغییر استراتژی مدیر صندوق از مقایسهٔ گزارش هر ماه با ماه قبل
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={analyzing || loading || !analyzeState?.canAnalyze}
          title={analyzeState?.reasonFa ?? undefined}
          onClick={onAnalyze}
        >
          {analyzing ? 'در حال تحلیل...' : 'تحلیل ماه‌به‌ماه با AI'}
        </button>
      </div>

      {!loading && analyzeState && !analyzeState.canAnalyze && analyzeState.reasonFa && (
        <p className="text-xs text-navy-800/50">{analyzeState.reasonFa}</p>
      )}
      {msg && <p className="text-sm">{msg}</p>}

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
                : 'تحلیل ماه‌به‌ماه هنوز انجام نشده. با آنالیز گزارش ماه بعد، خودکار ساخته می‌شود.'}
            </p>
          ) : (
            <div className="space-y-4">
              {insights.map((ins) => (
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
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {analyzing && (
        <WaitingOverlay
          title="در حال تحلیل ماه‌به‌ماه"
          description="تغییر استراتژی و عملکرد صندوق در طول زمان با AI بررسی می‌شود."
          steps={ANALYZE_STEPS}
        />
      )}
    </section>
  );
}
