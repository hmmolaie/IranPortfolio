'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  FINANCIAL_FIGURE_LABELS_FA,
  MACRO_DRIVER_LABELS_FA,
  type FinancialFigures,
  type MacroDriverKey,
} from '@sabadyar/shared';
import { api, formatNum, getUserRole } from '@/lib/api';
import { formatShamsiDateTime } from '@/lib/shamsi-date';
import { useToast } from '@/components/Toast';

export type Ratios = {
  epsAnnual: number | null;
  bvps: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  dividendYield: number | null;
  cashPerShare: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  cashRatio: number | null;
  debtToEquity: number | null;
  borrowingsToEquity: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  revenueGrowth: number | null;
  profitGrowth: number | null;
  epsGrowth: number | null;
  ocfToProfit: number | null;
  freeCashFlow: number | null;
  inventoryToCurrentAssets: number | null;
  receivableDays: number | null;
};

export type Score = {
  raw: number | null;
  effective: number | null;
  parts: { valuation: number | null; profitability: number | null; growth: number | null; health: number | null; llm: number | null };
  ageMonths: number | null;
  freshness: number;
  stale: boolean;
  reasonsFa: string[];
  cautionsFa: string[];
};

export type Macro = {
  score: number;
  lines: Array<{ key: MacroDriverKey; labelFa: string; sensitivity: number; changePct: number; effect: number }>;
  summaryFa: string | null;
};

export type Driver = { key: MacroDriverKey; labelFa: string; last: number; changePct: number; asOf: string; unitFa: string };

export type FundamentalView = {
  instrumentId: string;
  symbol: string;
  nameFa: string | null;
  price: number | null;
  statementId: string;
  reportTypeFa: string;
  periodEndFa: string | null;
  periodMonths: number | null;
  audited: boolean | null;
  figures: FinancialFigures;
  ratios: Ratios;
  score: Score;
  sensitivity: Partial<Record<MacroDriverKey, number>> & { noteFa?: string | null };
  macro: Macro | null;
  summaryFa: string | null;
};

type StatementItem = {
  id: string;
  fileName: string;
  fileKind: string;
  reportTypeFa: string | null;
  periodEndFa: string | null;
  periodMonths: number | null;
  audited: boolean | null;
  consolidated: boolean | null;
  summaryFa: string | null;
  strengthsFa: string | null;
  weaknessesFa: string | null;
  risksFa: string | null;
  llmScore: number | null;
  companyFa: string | null;
  mismatchFa: string | null;
  analysisStatus: 'pending' | 'running' | 'done' | 'failed' | 'duplicate';
  analysisError: string | null;
  source?: 'manual' | 'codal' | string;
  noticeTitle?: string | null;
  publishedAtFa?: string | null;
  createdAt: string;
  isLatest: boolean;
  view: FundamentalView | null;
};

type StatementsDto = { supported: boolean; symbol?: string; items: StatementItem[]; drivers: Driver[] };

const POLL_MS = 10_000;

/** ارقام صورت مالی به میلیون ریال است */
export function formatMillionRial(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${formatNum(Math.round((v / 1_000_000) * 10) / 10)} هزار میلیارد ریال`;
  if (abs >= 1_000) return `${formatNum(Math.round(v / 1_000))} میلیارد ریال`;
  return `${formatNum(v)} میلیون ریال`;
}

export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toLocaleString('fa-IR', { maximumFractionDigits: digits })}٪`;
}

export function formatTimes(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

export function scoreTone(v: number | null | undefined): string {
  if (v == null) return 'bg-navy-900/5 text-navy-800';
  if (v >= 70) return 'bg-emerald-50 text-emerald-800';
  if (v >= 50) return 'bg-amber-50 text-amber-800';
  return 'bg-red-50 text-red-800';
}

const FIGURE_ROWS: Array<keyof FinancialFigures> = [
  'revenue',
  'grossProfit',
  'operatingProfit',
  'netProfit',
  'cash',
  'shortTermInvestments',
  'inventory',
  'receivables',
  'currentAssets',
  'totalAssets',
  'currentLiabilities',
  'totalLiabilities',
  'borrowings',
  'equity',
  'capital',
  'retainedEarnings',
  'operatingCashFlow',
  'capex',
];

function ratioRows(r: Ratios): Array<[string, string, string]> {
  return [
    ['P/E (سود سالانه‌شده)', formatTimes(r.pe), 'قیمت روز تقسیم بر سود هر سهم سالانه‌شده'],
    ['P/B', formatTimes(r.pb), 'قیمت تقسیم بر ارزش دفتری هر سهم'],
    ['P/S', formatTimes(r.ps), 'ارزش بازار تقسیم بر فروش سالانه‌شده'],
    ['سود هر سهم سالانه‌شده', r.epsAnnual != null ? `${formatNum(Math.round(r.epsAnnual))} ریال` : '—', ''],
    ['ارزش دفتری هر سهم', r.bvps != null ? `${formatNum(Math.round(r.bvps))} ریال` : '—', ''],
    ['نقد و سرمایه‌گذاری کوتاه‌مدت هر سهم', r.cashPerShare != null ? `${formatNum(Math.round(r.cashPerShare))} ریال` : '—', ''],
    ['بازده سود نقدی', formatPct(r.dividendYield, 1), ''],
    ['حاشیهٔ سود ناخالص', formatPct(r.grossMargin), ''],
    ['حاشیهٔ سود عملیاتی', formatPct(r.operatingMargin), ''],
    ['حاشیهٔ سود خالص', formatPct(r.netMargin), ''],
    ['بازده حقوق صاحبان سهام (ROE)', formatPct(r.roe), 'سالانه‌شده'],
    ['بازده دارایی (ROA)', formatPct(r.roa), 'سالانه‌شده'],
    ['رشد فروش', formatPct(r.revenueGrowth), 'نسبت به دورهٔ مشابه قبل'],
    ['رشد سود خالص', formatPct(r.profitGrowth), 'نسبت به دورهٔ مشابه قبل'],
    ['رشد سود هر سهم', formatPct(r.epsGrowth), ''],
    ['نسبت جاری', formatTimes(r.currentRatio, 2), 'دارایی جاری تقسیم بر بدهی جاری'],
    ['نسبت آنی', formatTimes(r.quickRatio, 2), 'بدون موجودی انبار و پیش‌پرداخت'],
    ['نسبت نقد', formatTimes(r.cashRatio, 2), ''],
    ['بدهی به حقوق مالکانه', formatTimes(r.debtToEquity, 2), ''],
    ['تسهیلات به حقوق مالکانه', formatTimes(r.borrowingsToEquity, 2), ''],
    ['جریان نقد عملیاتی به سود', formatTimes(r.ocfToProfit, 2), 'بالای ۱ یعنی سود نقد شده است'],
    ['جریان نقد آزاد', formatMillionRial(r.freeCashFlow), 'جریان نقد عملیاتی منهای خرید دارایی ثابت'],
    ['موجودی انبار از دارایی جاری', formatPct(r.inventoryToCurrentAssets), ''],
    ['دوره وصول مطالبات', r.receivableDays != null ? `${formatNum(Math.round(r.receivableDays))} روز` : '—', ''],
  ];
}

function sensitivityLabel(v: number): string {
  if (v >= 1.5) return 'خیلی مثبت';
  if (v > 0) return 'مثبت';
  if (v <= -1.5) return 'خیلی منفی';
  if (v < 0) return 'منفی';
  return 'بی‌اثر';
}

export function ScoreBadge({ score }: { score: Score }) {
  return (
    <span className={clsx('rounded-full px-3 py-1 text-sm font-semibold', scoreTone(score.effective))}>
      امتیاز بنیادی {score.effective != null ? score.effective.toLocaleString('fa-IR') : '—'} از ۱۰۰
    </span>
  );
}

function StatementView({ item }: { item: StatementItem }) {
  const view = item.view;
  if (!view) return null;
  const parts = view.score.parts;
  const partRows: Array<[string, number | null]> = [
    ['ارزش‌گذاری', parts.valuation],
    ['سودآوری', parts.profitability],
    ['رشد', parts.growth],
    ['سلامت مالی', parts.health],
    ['نظر مدل', parts.llm],
  ];
  const sens = (Object.keys(MACRO_DRIVER_LABELS_FA) as MacroDriverKey[]).filter((k) => view.sensitivity[k] != null);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreBadge score={view.score} />
        {view.score.raw != null && view.score.raw !== view.score.effective && (
          <span className="text-xs text-navy-800/60">
            امتیاز خام {view.score.raw.toLocaleString('fa-IR')}؛ به دلیل قدمت گزارش با وزن{' '}
            {Math.round(view.score.freshness * 100).toLocaleString('fa-IR')}٪ لحاظ شد
          </span>
        )}
        {view.price != null && (
          <span className="text-xs text-navy-800/60">قیمت مبنا: {formatNum(view.price)} ریال</span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-5">
        {partRows.map(([label, v]) => (
          <div key={label} className="rounded-lg bg-navy-50/60 px-3 py-2">
            <div className="text-xs text-navy-800/60">{label}</div>
            <div className="mt-1 h-1.5 rounded-full bg-navy-900/10">
              <div className="h-1.5 rounded-full bg-navy-900" style={{ width: `${v ?? 0}%` }} />
            </div>
            <div className="mt-1 text-sm font-medium">{v != null ? `${v.toLocaleString('fa-IR')}٪` : '—'}</div>
          </div>
        ))}
      </div>

      {(view.score.reasonsFa.length > 0 || view.score.cautionsFa.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {view.score.reasonsFa.length > 0 && (
            <ul className="space-y-1 text-sm text-emerald-800">
              {view.score.reasonsFa.map((r) => (
                <li key={r}>+ {r}</li>
              ))}
            </ul>
          )}
          {view.score.cautionsFa.length > 0 && (
            <ul className="space-y-1 text-sm text-red-800">
              {view.score.cautionsFa.map((r) => (
                <li key={r}>− {r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <h4 className="mb-2 text-sm font-semibold text-navy-900">ارقام مهم</h4>
          <table className="w-full text-sm">
            <tbody>
              {FIGURE_ROWS.filter((k) => view.figures[k] != null).map((k) => (
                <tr key={k} className="border-b border-navy-900/5">
                  <td className="py-1.5 text-navy-800/75">{FINANCIAL_FIGURE_LABELS_FA[k]}</td>
                  <td className="py-1.5 text-start font-medium">{formatMillionRial(view.figures[k])}</td>
                </tr>
              ))}
              {view.figures.eps != null && (
                <tr className="border-b border-navy-900/5">
                  <td className="py-1.5 text-navy-800/75">{FINANCIAL_FIGURE_LABELS_FA.eps}</td>
                  <td className="py-1.5 text-start font-medium">
                    {formatNum(view.figures.eps)}
                    {view.figures.prevEps != null && (
                      <span className="ms-2 text-xs text-navy-800/55">دورهٔ مشابه قبل {formatNum(view.figures.prevEps)}</span>
                    )}
                  </td>
                </tr>
              )}
              {view.figures.dps != null && (
                <tr className="border-b border-navy-900/5">
                  <td className="py-1.5 text-navy-800/75">{FINANCIAL_FIGURE_LABELS_FA.dps}</td>
                  <td className="py-1.5 text-start font-medium">{formatNum(view.figures.dps)}</td>
                </tr>
              )}
              {view.figures.exportSalesPct != null && (
                <tr className="border-b border-navy-900/5">
                  <td className="py-1.5 text-navy-800/75">سهم فروش صادراتی</td>
                  <td className="py-1.5 text-start font-medium">{formatPct(view.figures.exportSalesPct)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <h4 className="mb-2 text-sm font-semibold text-navy-900">نسبت‌های مالی</h4>
          <table className="w-full text-sm">
            <tbody>
              {ratioRows(view.ratios)
                .filter(([, v]) => v !== '—')
                .map(([label, v, hint]) => (
                  <tr key={label} className="border-b border-navy-900/5" title={hint || undefined}>
                    <td className="py-1.5 text-navy-800/75">{label}</td>
                    <td className="py-1.5 text-start font-medium">{v}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {sens.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-navy-900">حساسیت سود به عوامل بیرونی</h4>
          <div className="flex flex-wrap gap-2">
            {sens.map((k) => {
              const v = view.sensitivity[k] ?? 0;
              return (
                <span
                  key={k}
                  className={clsx(
                    'rounded-full px-3 py-1 text-xs',
                    v > 0 ? 'bg-emerald-50 text-emerald-800' : v < 0 ? 'bg-red-50 text-red-800' : 'bg-navy-900/5 text-navy-800',
                  )}
                >
                  {MACRO_DRIVER_LABELS_FA[k]}: {sensitivityLabel(v)}
                </span>
              );
            })}
          </div>
          {view.sensitivity.noteFa && <p className="text-xs leading-6 text-navy-800/65">{view.sensitivity.noteFa}</p>}
          {view.macro?.summaryFa && (
            <p
              className={clsx(
                'rounded-lg px-3 py-2 text-sm leading-7',
                view.macro.score >= 3 ? 'bg-emerald-50 text-emerald-900' : view.macro.score <= -3 ? 'bg-red-50 text-red-900' : 'bg-navy-50 text-navy-900',
              )}
            >
              اثر تغییرات یک ماه اخیر: {view.macro.summaryFa}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3 text-sm leading-7">
        {item.summaryFa && <p className="text-navy-900">{item.summaryFa}</p>}
        {item.strengthsFa && (
          <p>
            <span className="font-semibold text-emerald-800">نقاط قوت: </span>
            <span className="whitespace-pre-line text-navy-800/85">{item.strengthsFa}</span>
          </p>
        )}
        {item.weaknessesFa && (
          <p>
            <span className="font-semibold text-red-800">نقاط ضعف: </span>
            <span className="whitespace-pre-line text-navy-800/85">{item.weaknessesFa}</span>
          </p>
        )}
        {item.risksFa && (
          <p>
            <span className="font-semibold text-amber-800">ریسک‌ها: </span>
            <span className="whitespace-pre-line text-navy-800/85">{item.risksFa}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function FinancialStatements({ instrumentId }: { instrumentId: string }) {
  const toast = useToast();
  const [data, setData] = useState<StatementsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [publishedAtFa, setPublishedAtFa] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isAdmin = getUserRole() === 'ADMIN';

  const load = useCallback(() => {
    return api<StatementsDto>(`/fundamentals/instruments/${instrumentId}`)
      .then((res) => {
        setData(res);
        setFailed(false);
        return res;
      })
      .catch(() => {
        setFailed(true);
        return null;
      });
  }, [instrumentId]);

  useEffect(() => {
    setData(null);
    setOpen({});
    void load();
  }, [load]);

  const pending = data?.items.some((i) => i.analysisStatus === 'pending' || i.analysisStatus === 'running') ?? false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (noticeTitle.trim()) fd.append('noticeTitle', noticeTitle.trim());
      if (publishedAtFa.trim()) fd.append('publishedAtFa', publishedAtFa.trim());
      await api(`/fundamentals/instruments/${instrumentId}/upload`, { method: 'POST', body: fd });
      toast.success('فایل ثبت شد و تحلیل آن در پس‌زمینه انجام می‌شود.');
      setFile(null);
      setNoticeTitle('');
      setPublishedAtFa('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    try {
      await api(`/fundamentals/statements/${id}/retry`, { method: 'POST' });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function remove(item: StatementItem) {
    if (!confirm(`صورت مالی «${item.fileName}» و تحلیل آن حذف شود؟`)) return;
    try {
      await api(`/fundamentals/statements/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (data && !data.supported) return null;
  if (!data && !failed) return null;
  if (!isAdmin && data && data.items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-navy-900">صورت‌های مالی و تحلیل بنیادی</h2>
        <p className="mt-2 text-sm leading-7 text-navy-800/70">
          ارقام از صورت‌های مالی بارگذاری‌شده با هوش مصنوعی استخراج و نسبت‌ها با آخرین قیمت محاسبه شده‌اند. تازه‌ترین دوره مبنای
          امتیاز است و گزارش‌های قدیمی‌تر کم‌اثرتر در نظر گرفته می‌شوند. این تحلیل توصیهٔ خرید یا فروش نیست.
        </p>
      </div>

      {failed && <p className="text-sm text-red-700">بارگذاری صورت‌های مالی ممکن نشد.</p>}

      {isAdmin && (
        <form onSubmit={onUpload} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="statement-file">
              بارگذاری صورت مالی یا گزارش مالی (PDF یا اکسل کدال)
            </label>
            <input
              id="statement-file"
              ref={fileRef}
              type="file"
              accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="min-w-[14rem] flex-1">
            <label className="label" htmlFor="statement-title">
              عنوان اطلاعیه در کدال (اختیاری)
            </label>
            <input
              id="statement-title"
              className="input"
              value={noticeTitle}
              maxLength={500}
              onChange={(e) => setNoticeTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="statement-published">
              زمان انتشار (اختیاری)
            </label>
            <input
              id="statement-published"
              className="input max-w-[12rem]"
              dir="ltr"
              placeholder="1405/01/25 12:30"
              value={publishedAtFa}
              maxLength={40}
              onChange={(e) => setPublishedAtFa(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!file || busy}>
            {busy ? 'در حال ارسال…' : 'بارگذاری و تحلیل'}
          </button>
        </form>
      )}

      {data && data.items.length === 0 && (
        <p className="text-sm text-navy-800/60">هنوز صورت مالی برای این سهم بارگذاری نشده است.</p>
      )}

      <div className="space-y-3">
        {data?.items.map((item) => {
          const expanded = open[item.id] ?? item.isLatest;
          const age = item.view?.score.ageMonths;
          return (
            <article key={item.id} className="card space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-start font-semibold text-navy-900 hover:underline"
                  onClick={() => setOpen((o) => ({ ...o, [item.id]: !expanded }))}
                  disabled={!item.view}
                >
                  {item.reportTypeFa ?? 'صورت مالی'}
                  {item.periodEndFa ? ` — منتهی به ${item.periodEndFa.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}` : ''}
                </button>
                {item.isLatest && <span className="rounded-full bg-navy-900 px-2 py-0.5 text-xs text-white">تازه‌ترین</span>}
                {item.audited === true && <span className="rounded-full bg-navy-900/5 px-2 py-0.5 text-xs">حسابرسی‌شده</span>}
                {item.audited === false && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">حسابرسی‌نشده</span>}
                {item.consolidated === true && <span className="rounded-full bg-navy-900/5 px-2 py-0.5 text-xs">تلفیقی</span>}
                {age != null && age > 12 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                    قدیمی ({age.toLocaleString('fa-IR')} ماه)
                  </span>
                )}
                {item.view && !expanded && <ScoreBadge score={item.view.score} />}
                {item.analysisStatus === 'pending' || item.analysisStatus === 'running' ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">در حال تحلیل…</span>
                ) : null}
                {item.analysisStatus === 'failed' && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800">تحلیل ناموفق</span>
                )}
                {item.analysisStatus === 'duplicate' && (
                  <span className="rounded-full bg-navy-900/5 px-2 py-0.5 text-xs text-navy-800/70">تکراری</span>
                )}
                {item.source === 'codal' && (
                  <span className="rounded-full bg-navy-900/5 px-2 py-0.5 text-xs">از کدال</span>
                )}
                <span className="ms-auto text-xs text-navy-800/50">
                  {item.noticeTitle ?? item.fileName}
                  {item.publishedAtFa
                    ? ` · انتشار ${item.publishedAtFa.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}`
                    : ''}
                  {' · ثبت '}
                  {formatShamsiDateTime(item.createdAt, 'short')}
                </span>
                {isAdmin && (
                  <span className="flex gap-3 text-xs">
                    {item.analysisStatus === 'failed' && (
                      <button type="button" className="text-navy-800 hover:underline" onClick={() => void retry(item.id)}>
                        تحلیل دوباره
                      </button>
                    )}
                    <button type="button" className="text-red-700 hover:underline" onClick={() => void remove(item)}>
                      حذف
                    </button>
                  </span>
                )}
              </div>
              {isAdmin && item.mismatchFa && <p className="text-sm text-amber-800">{item.mismatchFa}</p>}
              {isAdmin && (item.analysisStatus === 'failed' || item.analysisStatus === 'duplicate') && item.analysisError && (
                <p className="whitespace-pre-line text-sm text-red-700">{item.analysisError}</p>
              )}
              {expanded && <StatementView item={item} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
