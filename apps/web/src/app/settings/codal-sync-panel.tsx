'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { formatShamsiDateTime } from '@/lib/shamsi-date';
import { useToast } from '@/components/Toast';

type RunItemStatus = 'queued' | 'downloading' | 'analyzing' | 'done' | 'duplicate' | 'skipped' | 'failed';
type RunStatus = 'running' | 'ok' | 'stopped_ai' | 'stopped_crawl' | 'failed';

type RunItem = {
  tracingNo: number;
  symbol: string;
  titleFa: string;
  publishedAtFa: string;
  status: RunItemStatus;
  messageFa: string | null;
  instrumentId: string | null;
  statementId: string | null;
};

type SyncStatus = {
  fromDateFa: string;
  toDateFa: string;
  lastPublishedFa: string | null;
  lastRunAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunTrigger: 'auto' | 'manual' | null;
  lastRunStatus: RunStatus | null;
  lastRunMessage: string | null;
  codalHour: number;
  codalMinute: number;
  listPageUrl: string;
  running: boolean;
  run: {
    trigger: 'auto' | 'manual';
    fromDateFa: string;
    toDateFa: string;
    startedAt: string;
    finishedAt: string | null;
    status: RunStatus;
    messageFa: string | null;
    pagesRead: number;
    items: RunItem[];
  } | null;
};

type Recorded = {
  id: string;
  instrumentId: string;
  symbol: string;
  source: 'manual' | 'codal' | string;
  tracingNo: number | null;
  noticeTitle: string | null;
  publishedAtFa: string | null;
  fileName: string;
  reportTypeFa: string | null;
  periodEndFa: string | null;
  analysisStatus: 'pending' | 'running' | 'done' | 'failed' | 'duplicate';
  analysisError: string | null;
  createdAt: string;
};

const POLL_MS = 4000;

const ITEM_STATUS_FA: Record<RunItemStatus, string> = {
  queued: 'در نوبت',
  downloading: 'در حال دانلود',
  analyzing: 'در حال آنالیز',
  done: 'آنالیز شد',
  duplicate: 'قبلاً ثبت شده',
  skipped: 'نادیده گرفته شد',
  failed: 'ناموفق',
};

const RUN_STATUS_FA: Record<RunStatus, string> = {
  running: 'در حال اجرا',
  ok: 'کامل شد',
  stopped_ai: 'متوقف شد (خطای هوش مصنوعی)',
  stopped_crawl: 'متوقف شد (خطای دریافت از کدال)',
  failed: 'ناموفق',
};

const ANALYSIS_STATUS_FA: Record<Recorded['analysisStatus'], string> = {
  pending: 'در صف',
  running: 'در حال آنالیز',
  done: 'آنالیز شده',
  failed: 'ناموفق',
  duplicate: 'تکراری',
};

function faDigits(s: string | null | undefined): string {
  return String(s ?? '').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function statusTone(status: string): string {
  if (status === 'done' || status === 'ok') return 'bg-emerald-50 text-emerald-800';
  if (status === 'failed' || status === 'stopped_ai' || status === 'stopped_crawl') return 'bg-red-50 text-red-800';
  if (status === 'duplicate' || status === 'skipped') return 'bg-navy-900/5 text-navy-800/70';
  return 'bg-amber-50 text-amber-800';
}

export function CodalSyncPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [form, setForm] = useState({ fromDateFa: '', toDateFa: '' });
  const [recorded, setRecorded] = useState<Recorded[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async (resetForm = false) => {
    const s = await api<SyncStatus>('/fundamentals/codal-sync');
    setStatus(s);
    if (resetForm) setForm({ fromDateFa: s.fromDateFa, toDateFa: s.toDateFa });
    return s;
  }, []);

  const loadRecorded = useCallback(async () => {
    setRecorded(await api<Recorded[]>('/fundamentals/recorded?limit=300'));
  }, []);

  useEffect(() => {
    Promise.all([loadStatus(true), loadRecorded()]).catch((e) => setError((e as Error).message));
  }, [loadStatus, loadRecorded]);

  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      loadStatus()
        .then((s) => {
          if (!s.running) {
            setForm({ fromDateFa: s.fromDateFa, toDateFa: s.toDateFa });
            void loadRecorded();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [running, loadStatus, loadRecorded]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/fundamentals/codal-sync', { method: 'PUT', body: JSON.stringify(form) });
      await loadStatus(true);
      toast.success('بازهٔ تاریخ ذخیره شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const s = await api<SyncStatus>('/fundamentals/codal-sync/run', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setStatus(s);
      toast.success('به‌روزرسانی دستی از کدال شروع شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const run = status?.run ?? null;
  const counts = run
    ? run.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {})
    : {};
  const clock = status
    ? faDigits(`${String(status.codalHour).padStart(2, '0')}:${String(status.codalMinute).padStart(2, '0')}`)
    : '';

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card grid max-w-3xl gap-4">
        <h2 className="text-lg font-semibold">به‌روزرسانی اطلاعات از کدال</h2>
        <p className="text-sm leading-7 text-navy-800/75">
          هر روز ساعت {clock || '—'} تهران (از تب «ساعت به‌روزرسانی») صورت‌های مالی منتشرشده در بازهٔ زیر از کدال خوانده
          می‌شود و فایل اکسل هر اطلاعیه، مثل بارگذاری دستی در صفحهٔ سهم، برای همان نماد آنالیز می‌شود. گزارشی که قبلاً ثبت
          شده دوباره به هوش مصنوعی فرستاده نمی‌شود. ردیفی که اکسل ندارد یا دانلودش خطا بدهد نادیده گرفته می‌شود. اگر هوش
          مصنوعی خطا بدهد یا دریافت از کدال چند بار پشت‌سرهم ناموفق باشد، کار متوقف و پیام در «خطاهای مشاهده شده» ثبت
          می‌شود و نوبت بعد فردا در همان ساعت است. بعد از هر اجرا شروع بازه فردای آخرین انتشار آنالیزشده و پایان آن یک ماه
          بعد قرار می‌گیرد.
        </p>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="label" htmlFor="codal-from">
              از تاریخ (FromDate)
            </label>
            <input
              id="codal-from"
              className="input max-w-[11rem]"
              dir="ltr"
              placeholder="1405/01/01"
              value={form.fromDateFa}
              onChange={(e) => setForm({ ...form, fromDateFa: e.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="codal-to">
              تا تاریخ (ToDate)
            </label>
            <input
              id="codal-to"
              className="input max-w-[11rem]"
              dir="ltr"
              placeholder="1405/01/31"
              value={form.toDateFa}
              onChange={(e) => setForm({ ...form, toDateFa: e.target.value })}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn-secondary" disabled={busy || running}>
            ذخیرهٔ بازه
          </button>
          <button type="button" className="btn-primary" disabled={busy || running} onClick={() => void runNow()}>
            {running ? 'در حال اجرا…' : 'به‌روزرسانی دستی'}
          </button>
        </div>
        {status && (
          <dl className="grid gap-2 text-sm leading-7 text-navy-800/80 sm:grid-cols-2">
            <div>
              <dt className="inline text-navy-800/55">آخرین انتشار آنالیزشده: </dt>
              <dd className="inline">{status.lastPublishedFa ? faDigits(status.lastPublishedFa) : '—'}</dd>
            </div>
            <div>
              <dt className="inline text-navy-800/55">آخرین اجرا: </dt>
              <dd className="inline">
                {status.lastRunAt ? formatShamsiDateTime(status.lastRunAt, 'short') : '—'}
                {status.lastRunTrigger ? ` (${status.lastRunTrigger === 'auto' ? 'خودکار' : 'دستی'})` : ''}
                {status.lastRunStatus ? ` · ${RUN_STATUS_FA[status.lastRunStatus] ?? status.lastRunStatus}` : ''}
              </dd>
            </div>
          </dl>
        )}
        {status?.lastRunMessage && !running && (
          <p
            className={clsx(
              'rounded-lg px-3 py-2 text-sm leading-7',
              status.lastRunStatus === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
            )}
          >
            {status.lastRunMessage}
          </p>
        )}
        {status && (
          <p className="text-xs leading-6 text-navy-800/55">
            صفحهٔ همین فیلتر در کدال:{' '}
            <a href={status.listPageUrl} target="_blank" rel="noreferrer" className="text-gold-700 hover:underline">
              مشاهده در codal.ir
            </a>
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>

      {run && (
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              اجرای {run.trigger === 'auto' ? 'خودکار' : 'دستی'} {faDigits(run.fromDateFa)} تا {faDigits(run.toDateFa)}
            </h3>
            <span className={clsx('rounded-full px-2 py-0.5 text-xs', statusTone(run.status))}>
              {RUN_STATUS_FA[run.status]}
            </span>
            <span className="text-xs text-navy-800/55">
              شروع {formatShamsiDateTime(run.startedAt, 'short')}
              {run.finishedAt ? ` · پایان ${formatShamsiDateTime(run.finishedAt, 'short')}` : ''}
              {` · ${run.pagesRead.toLocaleString('fa-IR')} صفحه از فهرست کدال`}
            </span>
          </div>
          {run.items.length > 0 && (
            <p className="text-xs text-navy-800/60">
              {(Object.keys(ITEM_STATUS_FA) as RunItemStatus[])
                .filter((k) => counts[k])
                .map((k) => `${ITEM_STATUS_FA[k]}: ${counts[k].toLocaleString('fa-IR')}`)
                .join(' · ')}
            </p>
          )}
          {run.messageFa && run.status !== 'running' && <p className="text-sm text-navy-800/80">{run.messageFa}</p>}
          <div className="max-h-[32rem] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-navy-800/55">
                  <th className="py-2 text-start">نماد</th>
                  <th className="py-2 text-start">عنوان اطلاعیه</th>
                  <th className="py-2 text-start">زمان انتشار</th>
                  <th className="py-2 text-start">وضعیت</th>
                  <th className="py-2 text-start">توضیح</th>
                </tr>
              </thead>
              <tbody>
                {run.items.map((item) => (
                  <tr key={item.tracingNo} className="border-t border-navy-900/10 align-top">
                    <td className="py-2 font-medium">
                      {item.instrumentId ? (
                        <Link href={`/market/${item.instrumentId}`} className="hover:underline">
                          {item.symbol}
                        </Link>
                      ) : (
                        item.symbol
                      )}
                    </td>
                    <td className="py-2 leading-6">{item.titleFa}</td>
                    <td className="whitespace-nowrap py-2">{faDigits(item.publishedAtFa)}</td>
                    <td className="py-2">
                      <span className={clsx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs', statusTone(item.status))}>
                        {ITEM_STATUS_FA[item.status]}
                      </span>
                    </td>
                    <td className="py-2 text-xs leading-6 text-navy-800/70">{item.messageFa ?? ''}</td>
                  </tr>
                ))}
                {run.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-navy-800/50">
                      {run.status === 'running' ? 'در حال خواندن فهرست از کدال…' : 'اطلاعیه‌ای در این بازه پیدا نشد.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold">صورت‌های مالی ثبت‌شده</h3>
          <button type="button" className="text-xs text-navy-800 hover:underline" onClick={() => void loadRecorded()}>
            تازه‌سازی
          </button>
        </div>
        <p className="text-xs leading-6 text-navy-800/60">
          گزارش‌هایی که از کدال یا با بارگذاری دستی ادمین در صفحهٔ سهم ثبت شده‌اند (۳۰۰ مورد آخر).
        </p>
        <div className="max-h-[36rem] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-navy-800/55">
                <th className="py-2 text-start">نماد</th>
                <th className="py-2 text-start">عنوان اطلاعیه</th>
                <th className="py-2 text-start">زمان انتشار</th>
                <th className="py-2 text-start">زمان ثبت در سیستم</th>
                <th className="py-2 text-start">منبع</th>
                <th className="py-2 text-start">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {recorded.map((r) => (
                <tr key={r.id} className="border-t border-navy-900/10 align-top">
                  <td className="py-2 font-medium">
                    <Link href={`/market/${r.instrumentId}`} className="hover:underline">
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="py-2 leading-6">
                    {r.noticeTitle ?? <span className="text-navy-800/50">{r.fileName}</span>}
                    {r.reportTypeFa && (
                      <span className="block text-xs text-navy-800/55">
                        {r.reportTypeFa}
                        {r.periodEndFa ? ` — منتهی به ${faDigits(r.periodEndFa)}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2">{r.publishedAtFa ? faDigits(r.publishedAtFa) : '—'}</td>
                  <td className="whitespace-nowrap py-2">{formatShamsiDateTime(r.createdAt, 'short')}</td>
                  <td className="py-2">{r.source === 'codal' ? 'کدال' : 'دستی'}</td>
                  <td className="py-2">
                    <span
                      className={clsx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs', statusTone(r.analysisStatus))}
                      title={r.analysisError ?? undefined}
                    >
                      {ANALYSIS_STATUS_FA[r.analysisStatus] ?? r.analysisStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {recorded.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-navy-800/50">
                    هنوز صورت مالی ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
