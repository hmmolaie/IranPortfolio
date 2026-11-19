'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, formatNum, getToken } from '@/lib/api';
import {
  formatPct,
  formatTimes,
  ScoreBadge,
  type Driver,
  type FundamentalView,
} from '@/components/FinancialStatements';

type Board = {
  noteFa: string;
  drivers: Driver[];
  ranked: FundamentalView[];
  macro: { positive: FundamentalView[]; negative: FundamentalView[] };
  staleCount: number;
};

type Tab = 'ranked' | 'macroUp' | 'macroDown';

const TABS: Array<{ key: Tab; label: string; empty: string }> = [
  { key: 'ranked', label: 'جذاب‌ترین از نظر بنیادی', empty: 'هنوز صورت مالی تحلیل‌شده‌ای نیست. ادمین از صفحهٔ هر سهم بارگذاری می‌کند.' },
  { key: 'macroUp', label: 'سود از تغییر دلار و کالاها', empty: 'سهمی با اثر مثبت محسوس از تغییرات یک ماه اخیر دیده نشد.' },
  { key: 'macroDown', label: 'زیان از تغییر دلار و کالاها', empty: 'سهمی با اثر منفی محسوس از تغییرات یک ماه اخیر دیده نشد.' },
];

function toFaDigits(s: string) {
  return s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function Row({ v, rank, macroMode }: { v: FundamentalView; rank: number; macroMode: boolean }) {
  const reasons = macroMode
    ? v.macro?.summaryFa
      ? [v.macro.summaryFa]
      : []
    : v.score.reasonsFa.slice(0, 4);
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-navy-800/50">{rank.toLocaleString('fa-IR')}</span>
        <Link href={`/market/${v.instrumentId}`} className="text-lg font-bold text-gold-700 hover:underline">
          {v.symbol}
        </Link>
        <span className="text-sm text-navy-800/70">{v.nameFa}</span>
        <ScoreBadge score={v.score} />
        {v.macro && v.macro.lines.length > 0 && (
          <span
            className={clsx(
              'rounded-full px-3 py-1 text-xs',
              v.macro.score >= 3 ? 'bg-emerald-50 text-emerald-800' : v.macro.score <= -3 ? 'bg-red-50 text-red-800' : 'bg-navy-900/5 text-navy-800',
            )}
          >
            اثر دلار و کالاها: {v.macro.score > 0 ? '+' : ''}
            {v.macro.score.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}
          </span>
        )}
        <span className="ms-auto text-xs text-navy-800/55">
          {v.reportTypeFa}
          {v.periodEndFa ? ` منتهی به ${toFaDigits(v.periodEndFa)}` : ''}
          {v.score.ageMonths != null ? ` · ${v.score.ageMonths.toLocaleString('fa-IR')} ماه پیش` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-800/80">
        <span>P/E: {formatTimes(v.ratios.pe)}</span>
        <span>P/B: {formatTimes(v.ratios.pb)}</span>
        <span>ROE: {formatPct(v.ratios.roe)}</span>
        <span>رشد سود: {formatPct(v.ratios.profitGrowth)}</span>
        <span>حاشیهٔ سود خالص: {formatPct(v.ratios.netMargin)}</span>
        <span>نسبت جاری: {formatTimes(v.ratios.currentRatio, 2)}</span>
        <span>بدهی به حقوق مالکانه: {formatTimes(v.ratios.debtToEquity, 2)}</span>
        {v.price != null && <span>قیمت: {formatNum(v.price)} ریال</span>}
      </div>
      {reasons.length > 0 && (
        <ul className="space-y-1 text-sm text-emerald-800">
          {reasons.map((r) => (
            <li key={r}>+ {r}</li>
          ))}
        </ul>
      )}
      {!macroMode && v.score.cautionsFa.length > 0 && (
        <ul className="space-y-1 text-sm text-red-800">
          {v.score.cautionsFa.slice(0, 3).map((r) => (
            <li key={r}>− {r}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function FundamentalsPage() {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('ranked');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<Board>('/fundamentals/suggestions')
      .then(setBoard)
      .catch((e) => setError((e as Error).message));
  }, [router]);

  const rows =
    tab === 'ranked' ? board?.ranked ?? [] : tab === 'macroUp' ? board?.macro.positive ?? [] : board?.macro.negative ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">پیشنهادهای بنیادی</h1>
        <p className="mt-2 text-navy-800/70">
          مقایسهٔ سهم‌ها از روی صورت‌های مالی بارگذاری‌شده: ارزش‌گذاری، سودآوری، رشد و سلامت مالی، و اثر تغییرات اخیر دلار، نفت و فلزات.
        </p>
      </div>

      {board && board.drivers.length > 0 && (
        <section className="flex flex-wrap gap-2">
          {board.drivers.map((d) => (
            <span
              key={d.key}
              className={clsx(
                'rounded-full px-3 py-1 text-xs',
                d.changePct >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
              )}
              title={`${formatNum(d.last)} ${d.unitFa}`}
            >
              {d.labelFa}: {d.changePct >= 0 ? '+' : ''}
              {d.changePct.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪ در یک ماه
            </span>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.key ? 'bg-navy-900 text-white' : 'bg-navy-50 text-navy-800'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!board && !error && <p className="text-sm text-navy-800/60">در حال بارگذاری...</p>}

      {board && (
        <div className="space-y-3">
          {rows.map((v, i) => (
            <Row key={v.statementId} v={v} rank={i + 1} macroMode={tab !== 'ranked'} />
          ))}
          {rows.length === 0 && <p className="text-sm text-navy-800/60">{TABS.find((t) => t.key === tab)?.empty}</p>}
        </div>
      )}
      {board && (
        <p className="text-xs leading-6 text-navy-800/55">
          {board.noteFa}
          {board.staleCount > 0 ? ` ${board.staleCount.toLocaleString('fa-IR')} سهم فقط گزارش خیلی قدیمی دارند و در فهرست نیامده‌اند.` : ''}
        </p>
      )}
    </div>
  );
}
