'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { API_URL, api, formatNum, getToken } from '@/lib/api';
import { getCurrentShamsiParts } from '@/lib/shamsi-date';
import { WaitingOverlay } from '@/components/WaitingOverlay';

type FundDefinition = {
  id: string;
  nameFa: string;
  symbolCode?: string | null;
  description?: string | null;
};

type Fund = {
  id: string;
  fundName: string;
  reportMonth: string;
  reportYear?: number | null;
  reportMonthNum?: number | null;
  fundDefinitionId?: string | null;
  guessedStrategyFa?: string | null;
  rating?: number | null;
  managerTechnicalScore?: number | null;
  riskAppetiteScore?: number | null;
  professionalismScore?: number | null;
  useInSuggestions: boolean;
  extractedSheetsJson?: {
    sheetCount?: number;
    sheetNames?: string[];
  } | null;
  lessons: Array<{ id: string; titleFa: string }>;
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

type SortKey =
  | 'newest'
  | 'rating'
  | 'managerTechnicalScore'
  | 'riskAppetiteScore'
  | 'professionalismScore';

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

const PAGE_SIZE = 10;

const UPLOAD_STEPS = [
  'خواندن فایل گزارش...',
  'استخراج متن و جداول...',
  'تحلیل استراتژی مدیر با AI...',
  'امتیازدهی فنی و ریسک...',
  'ذخیره نتیجه در پایگاه داده...',
];

const ANALYZE_STEPS = [
  'جمع‌آوری گزارش‌های ماهانه...',
  'مقایسه ترکیب سبدها...',
  'تحلیل تغییر استراتژی با AI...',
  'ثبت بینش ماه‌به‌ماه...',
];

function ScoreChip({ label, value }: { label: string; value?: number | null }) {
  if (value == null) return null;
  return (
    <div className="rounded-lg bg-navy-50 px-3 py-2 text-center">
      <div className="text-xs text-navy-800/55">{label}</div>
      <div className="text-lg font-semibold">{formatNum(value)}</div>
      <div className="text-[10px] text-navy-800/40">از ۱۰</div>
    </div>
  );
}

function ScoreMini({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-navy-800/50">{label}</div>
      <div className="text-sm font-semibold">{value != null ? formatNum(value) : '—'}</div>
    </div>
  );
}

function monthLabel(f: Fund) {
  if (f.reportYear && f.reportMonthNum) {
    const yearFa = f.reportYear.toLocaleString('fa-IR', { useGrouping: false });
    return `${yearFa} / ${MONTHS_FA[f.reportMonthNum - 1] ?? f.reportMonthNum}`;
  }
  return f.reportMonth;
}

function scoreOf(f: Fund, key: SortKey): number {
  if (key === 'newest') return 0;
  const v = f[key];
  return v == null ? -1 : v;
}

export default function FundsPage() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<FundDefinition[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundDefinitionId, setFundDefinitionId] = useState('');
  const [reportYear, setReportYear] = useState(() => String(getCurrentShamsiParts().year));
  const [reportMonthNum, setReportMonthNum] = useState(() => String(getCurrentShamsiParts().month));
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [timelineFundId, setTimelineFundId] = useState('');
  const [timelineReports, setTimelineReports] = useState<Fund[]>([]);
  const [timelineInsights, setTimelineInsights] = useState<TimelineInsight[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [filterFundId, setFilterFundId] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadDefinitions() {
    const defs = await api<FundDefinition[]>('/funds/definitions');
    setDefinitions(defs);
    if (!fundDefinitionId && defs[0]) setFundDefinitionId(defs[0].id);
    if (!timelineFundId && defs[0]) setTimelineFundId(defs[0].id);
    return defs;
  }

  async function loadReports() {
    const data = await api<Fund[]>('/funds');
    setFunds(data);
  }

  async function load() {
    await Promise.all([loadDefinitions(), loadReports()]);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    load().catch(() => undefined);
  }, [router]);

  async function loadTimeline(fundId: string) {
    if (!fundId) return;
    setTimelineLoading(true);
    try {
      const data = await api<{
        fund: FundDefinition;
        reports: Fund[];
        insights: TimelineInsight[];
      }>(`/funds/timeline/${fundId}`);
      setTimelineReports(data.reports);
      setTimelineInsights(data.insights);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setTimelineLoading(false);
    }
  }

  useEffect(() => {
    if (timelineFundId) loadTimeline(timelineFundId).catch(() => undefined);
  }, [timelineFundId]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    funds.forEach((f) => {
      if (f.reportYear) years.add(f.reportYear);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [funds]);

  const filteredSorted = useMemo(() => {
    let list = [...funds];
    if (filterFundId) {
      list = list.filter((f) => f.fundDefinitionId === filterFundId);
    }
    if (filterYear) {
      list = list.filter((f) => String(f.reportYear ?? '') === filterYear);
    }
    if (filterMonth) {
      list = list.filter((f) => String(f.reportMonthNum ?? '') === filterMonth);
    }
    if (sortKey === 'newest') {
      list.sort((a, b) => {
        const ay = a.reportYear ?? 0;
        const by = b.reportYear ?? 0;
        if (ay !== by) return by - ay;
        return (b.reportMonthNum ?? 0) - (a.reportMonthNum ?? 0);
      });
    } else {
      list.sort((a, b) => scoreOf(b, sortKey) - scoreOf(a, sortKey));
    }
    return list;
  }, [funds, filterFundId, filterYear, filterMonth, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredSorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [filterFundId, filterYear, filterMonth, sortKey]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file || !fundDefinitionId) return;
    setLoading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fundDefinitionId', fundDefinitionId);
      fd.append('reportYear', reportYear);
      fd.append('reportMonthNum', reportMonthNum);
      const res = await fetch(`${API_URL}/api/funds/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const uploaded = (await res.json()) as Fund;
      const sheetInfo = uploaded.extractedSheetsJson?.sheetCount
        ? ` (${uploaded.extractedSheetsJson.sheetCount.toLocaleString('fa-IR')} شیت خوانده شد)`
        : '';
      setMsg(`گزارش تحلیل شد و ذخیره گردید${sheetInfo}.`);
      setFile(null);
      await load();
      if (timelineFundId === fundDefinitionId) await loadTimeline(fundDefinitionId);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`گزارش «${name}» حذف شود؟`)) return;
    setDeletingId(id);
    setMsg('');
    try {
      await api(`/funds/${id}`, { method: 'DELETE' });
      setFunds((prev) => prev.filter((f) => f.id !== id));
      setMsg('گزارش حذف شد.');
      if (timelineFundId) await loadTimeline(timelineFundId);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  async function onAnalyzeTimeline() {
    if (!timelineFundId) return;
    setAnalyzing(true);
    setMsg('');
    try {
      await api(`/funds/timeline/${timelineFundId}/analyze`, { method: 'POST' });
      setMsg('تحلیل عملکرد ماه‌به‌ماه انجام شد.');
      await loadTimeline(timelineFundId);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">صندوق‌های سرمایه‌گذاری</h1>
        <p className="mt-2 text-navy-800/70">
          گزارش ماهانه را به‌صورت PDF یا Excel بارگذاری کنید. ابتدا صندوق را در{' '}
          <Link href="/settings" className="text-navy-900 underline">
            تنظیمات
          </Link>{' '}
          تعریف کنید.
        </p>
      </div>

      {definitions.length === 0 && (
        <p className="rounded-lg bg-gold-400/15 px-4 py-3 text-sm">
          هنوز صندوقی تعریف نشده. از بخش «صندوق‌ها» در{' '}
          <Link href="/settings" className="font-medium underline">
            تنظیمات
          </Link>{' '}
          یک صندوق اضافه کنید.
        </p>
      )}

      <form onSubmit={onUpload} className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">نام صندوق</label>
          <select
            className="input"
            value={fundDefinitionId}
            onChange={(e) => setFundDefinitionId(e.target.value)}
            required
            disabled={definitions.length === 0 || loading}
          >
            <option value="">انتخاب صندوق...</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameFa}
                {d.symbolCode ? ` (${d.symbolCode})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">سال شمسی</label>
          <input
            className="input"
            type="number"
            min={1300}
            max={1500}
            value={reportYear}
            onChange={(e) => setReportYear(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div>
          <label className="label">ماه شمسی</label>
          <select
            className="input"
            value={reportMonthNum}
            onChange={(e) => setReportMonthNum(e.target.value)}
            required
            disabled={loading}
          >
            {MONTHS_FA.map((name, i) => (
              <option key={i + 1} value={String(i + 1)}>
                {i + 1} — {name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">فایل گزارش (PDF یا Excel)</label>
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            disabled={loading}
          />
        </div>
        <button className="btn-primary w-fit" disabled={loading || definitions.length === 0}>
          {loading ? 'در حال تحلیل...' : 'بارگذاری و تحلیل'}
        </button>
        {msg && <p className="text-sm sm:col-span-2">{msg}</p>}
      </form>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">عملکرد صندوق در طول زمان</h2>
            <p className="mt-1 text-sm text-navy-800/60">
              با بارگذاری گزارش‌های ماه‌های مختلف، تحلیل تغییر استراتژی مدیر صندوق
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">صندوق</label>
              <select
                className="input min-w-[12rem]"
                value={timelineFundId}
                onChange={(e) => setTimelineFundId(e.target.value)}
                disabled={definitions.length === 0 || analyzing}
              >
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameFa}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={!timelineFundId || analyzing || timelineReports.length < 2}
              onClick={onAnalyzeTimeline}
            >
              {analyzing ? 'در حال تحلیل...' : 'تحلیل ماه‌به‌ماه با AI'}
            </button>
          </div>
        </div>

        {timelineLoading ? (
          <p className="text-sm text-navy-800/60">در حال بارگذاری...</p>
        ) : (
          <>
            {timelineReports.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {timelineReports.map((r) => (
                  <span
                    key={r.id}
                    className="rounded-full bg-navy-50 px-3 py-1 text-xs text-navy-800"
                  >
                    {monthLabel(r)}
                    {r.rating != null && ` · امتیاز ${formatNum(r.rating)}`}
                  </span>
                ))}
              </div>
            )}

            {timelineInsights.length === 0 ? (
              <p className="text-sm text-navy-800/50">
                {timelineReports.length < 2
                  ? 'حداقل دو گزارش ماهانه برای تحلیل مقایسه‌ای لازم است.'
                  : 'تحلیل ماه‌به‌ماه هنوز انجام نشده. دکمه بالا را بزنید.'}
              </p>
            ) : (
              <div className="space-y-4">
                {timelineInsights.map((ins) => (
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
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">گزارش‌های بارگذاری‌شده</h2>
          <p className="text-xs text-navy-800/50">
            {filteredSorted.length.toLocaleString('fa-IR')} گزارش
          </p>
        </div>

        <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">نام صندوق</label>
            <select
              className="input"
              value={filterFundId}
              onChange={(e) => setFilterFundId(e.target.value)}
            >
              <option value="">همه صندوق‌ها</option>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameFa}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">سال</label>
            <select
              className="input"
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            >
              <option value="">همه سال‌ها</option>
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y.toLocaleString('fa-IR', { useGrouping: false })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ماه</label>
            <select
              className="input"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
            >
              <option value="">همه ماه‌ها</option>
              {MONTHS_FA.map((name, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">مرتب‌سازی</label>
            <select
              className="input"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="newest">جدیدترین گزارش</option>
              <option value="rating">امتیاز کلی</option>
              <option value="managerTechnicalScore">نمره فنی مدیر</option>
              <option value="riskAppetiteScore">ریسک‌پذیری</option>
              <option value="professionalismScore">حرفه‌ای‌بودن مالی</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          {pageItems.map((f) => {
            const open = expandedId === f.id;
            const trendHref = f.fundDefinitionId
              ? `/funds/${f.fundDefinitionId}`
              : null;
            return (
              <article
                key={f.id}
                className={clsx(
                  'card !p-0 overflow-hidden transition',
                  open && 'border-navy-900/20',
                )}
              >
                <div
                  className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-navy-50/50"
                  onClick={() => setExpandedId(open ? null : f.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(open ? null : f.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="min-w-0 flex-1">
                    {trendHref ? (
                      <Link
                        href={trendHref}
                        className="text-base font-semibold text-navy-900 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {f.fundName}
                      </Link>
                    ) : (
                      <span className="text-base font-semibold">{f.fundName}</span>
                    )}
                    <p className="mt-0.5 text-xs text-navy-800/50">
                      {monthLabel(f)}
                      {f.useInSuggestions && (
                        <span className="ms-2 rounded bg-gold-400/20 px-1.5 py-0.5 text-[10px] text-gold-500">
                          در پیشنهاد
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-3 sm:gap-4">
                    <ScoreMini label="کلی" value={f.rating} />
                    <ScoreMini label="فنی" value={f.managerTechnicalScore} />
                    <ScoreMini label="ریسک" value={f.riskAppetiteScore} />
                    <ScoreMini label="حرفه‌ای" value={f.professionalismScore} />
                  </div>
                  <span className="text-xs text-navy-800/40">{open ? '▲' : '▼'}</span>
                </div>

                {open && (
                  <div className="space-y-4 border-t border-navy-900/8 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-navy-800/50">
                        {f.extractedSheetsJson?.sheetCount != null && (
                          <span>
                            {f.extractedSheetsJson.sheetCount.toLocaleString('fa-IR')} شیت
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-secondary !px-3 !py-1.5 text-xs text-red-700 hover:bg-red-50"
                        disabled={deletingId === f.id}
                        onClick={() => onDelete(f.id, f.fundName)}
                      >
                        {deletingId === f.id ? 'در حال حذف...' : 'حذف گزارش'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <ScoreChip label="امتیاز کلی" value={f.rating} />
                      <ScoreChip label="نمره فنی مدیر" value={f.managerTechnicalScore} />
                      <ScoreChip label="ریسک‌پذیری" value={f.riskAppetiteScore} />
                      <ScoreChip label="حرفه‌ای‌بودن مالی" value={f.professionalismScore} />
                    </div>
                    {f.guessedStrategyFa && (
                      <p className="leading-7 text-navy-800/80">{f.guessedStrategyFa}</p>
                    )}
                    {f.lessons?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold">درس‌آموخته‌ها</h4>
                        <ul className="mt-2 list-disc space-y-1 pe-5 text-sm text-navy-800/75">
                          {f.lessons.map((l) => (
                            <li key={l.id}>{l.titleFa}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {trendHref && (
                      <Link href={trendHref} className="inline-block text-sm text-navy-900 underline">
                        مشاهده روند امتیازات این صندوق
                      </Link>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {filteredSorted.length === 0 && (
            <p className="text-sm text-navy-800/50">
              {funds.length === 0
                ? 'هنوز گزارشی بارگذاری نشده.'
                : 'با فیلترهای فعلی گزارشی پیدا نشد.'}
            </p>
          )}
        </div>

        {filteredSorted.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </button>
            <span className="text-sm text-navy-800/70">
              صفحه {currentPage.toLocaleString('fa-IR')} از {totalPages.toLocaleString('fa-IR')}
            </span>
            <button
              type="button"
              className="btn-secondary !px-3 !py-1.5 text-xs"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              بعدی
            </button>
          </div>
        )}
      </section>

      {loading && (
        <WaitingOverlay
          title="در حال تحلیل گزارش"
          description="فایل گزارش در حال استخراج و تحلیل با هوش مصنوعی است. لطفاً صفحه را نبندید."
          steps={UPLOAD_STEPS}
        />
      )}
      {analyzing && (
        <WaitingOverlay
          title="در حال تحلیل ماه‌به‌ماه"
          description="تغییر استراتژی و عملکرد صندوق در طول زمان با AI بررسی می‌شود."
          steps={ANALYZE_STEPS}
        />
      )}
    </div>
  );
}
