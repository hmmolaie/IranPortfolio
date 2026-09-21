'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, formatNum } from '@/lib/api';
import { formatShamsiDate } from '@/lib/shamsi-date';

type Level = 'LOW' | 'MEDIUM' | 'HIGH' | null;
type Line = {
  asset: string;
  labelFa: string;
  currentPct: number;
  targetPct: number;
  diffPct: number;
  action: 'INCREASE' | 'DECREASE' | 'HOLD';
  reasonFa: string;
  confidence: number | null;
};

type Report = {
  disclaimerFa: string;
  dna: {
    riskScore: number;
    horizon: 'SHORT' | 'MEDIUM' | 'LONG';
    liquidityLabelFa: string | null;
    inflationLabelFa: string | null;
    fxSensitivityLabelFa: string | null;
    fxExposureLabelFa: string;
    maxDrawdownPct: number | null;
  };
  regime: {
    regime: string;
    labelFa: string;
    confidence: number | null;
    summaryFa: string;
    enough: boolean;
    drivers: Array<{ labelFa: string }>;
  };
  risk: {
    score: number | null;
    noteFa: string;
    parts: Array<{ code: string; labelFa: string; level: Level; detailFa: string }>;
    drawdown: { pct: number | null; noteFa: string };
  };
  health: {
    score: number | null;
    parts: Array<{ code: string; labelFa: string; score: number; detailFa: string }>;
  };
  plan: { lines: Line[]; tilted: boolean };
  alerts: Array<{ code: string; titleFa: string; bodyFa: string }>;
  benchmark: {
    enough: boolean;
    noteFa: string;
    portfolioPct: number | null;
    usdPct: number | null;
    goldPct: number | null;
  };
};

type HistoryRow = {
  id: string;
  dateKey: string;
  labelFa: string;
  createdAt: string;
  payload?: {
    plan?: Array<{ labelFa: string; action: string; diffPct: number; reasonFa?: string }>;
  } | null;
};

const ACTION_FA = { INCREASE: 'افزایش', DECREASE: 'کاهش', HOLD: 'بدون تغییر' };
const HORIZON_FA = { SHORT: 'کوتاه', MEDIUM: 'میان‌مدت', LONG: 'بلند' };
const LEVEL_FA: Record<string, string> = { LOW: 'کم', MEDIUM: 'متوسط', HIGH: 'زیاد' };

export function IntelligencePanel({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [shocks, setShocks] = useState({ usdPct: '30', equityPct: '-20', goldPct: '20' });
  const [scenario, setScenario] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Report>(`/intelligence/portfolios/${portfolioId}`),
      api<HistoryRow[]>(`/intelligence/portfolios/${portfolioId}/history`),
    ])
      .then(([report, rows]) => {
        setData(report);
        setHistory(rows);
      })
      .catch((e) => setError((e as Error).message));
  }, [portfolioId]);

  async function runScenario(e: FormEvent) {
    e.preventDefault();
    setScenario('');
    try {
      const body: Record<string, number> = {};
      for (const [key, raw] of Object.entries(shocks)) {
        if (raw.trim() === '') continue;
        body[key] = Number(raw);
      }
      const res = await api<{
        enough: boolean;
        impactPct: number | null;
        noteFa: string;
      }>(`/intelligence/portfolios/${portfolioId}/scenario`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setScenario(
        res.enough && res.impactPct != null
          ? `اثر مستقیم فرض شما حدود ${formatNum(res.impactPct)} درصد ارزش سبد است. ${res.noteFa}`
          : res.noteFa,
      );
    } catch (err) {
      setScenario((err as Error).message);
    }
  }

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return null;

  return (
    <section className="space-y-4">
      <div className="card space-y-3">
        <h2 className="text-lg font-semibold">وضعیت بازار و سبد</h2>
        <p className="text-sm leading-7 text-navy-800/70">{data.disclaimerFa}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-navy-800/55">رژیم بازار</div>
            <div className="mt-1 text-xl font-semibold">{data.regime.labelFa}</div>
            <p className="mt-1 text-sm text-navy-800/70">{data.regime.summaryFa}</p>
          </div>
          <div>
            <div className="text-xs text-navy-800/55">سلامت سبد</div>
            <div className="mt-1 text-xl font-semibold">
              {data.health.score == null ? 'داده کافی نیست' : `${data.health.score.toLocaleString('fa-IR')} از ۱۰۰`}
            </div>
          </div>
          <div>
            <div className="text-xs text-navy-800/55">ریسک سبد</div>
            <div className="mt-1 text-xl font-semibold">
              {data.risk.score == null ? 'داده کافی نیست' : `${formatNum(data.risk.score)} از ۱۰`}
            </div>
          </div>
        </div>
        {data.regime.drivers.length > 0 && (
          <ul className="space-y-1 text-sm text-navy-800/80">
            {data.regime.drivers.map((d) => (
              <li key={d.labelFa}>{d.labelFa}</li>
            ))}
          </ul>
        )}
        {data.regime.confidence != null && (
          <p className="text-sm text-navy-800/60">
            اطمینان رژیم: {Math.round(data.regime.confidence * 100).toLocaleString('fa-IR')} درصد
          </p>
        )}
      </div>

      {data.alerts.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold">هشدارهای همین داده</h3>
          {data.alerts.map((a) => (
            <p key={a.code} className="text-sm leading-7">
              <span className="font-medium">{a.titleFa}. </span>
              {a.bodyFa}
            </p>
          ))}
        </div>
      )}

      <div className="card space-y-3">
        <h3 className="font-semibold">بازچینش پیشنهادی</h3>
        <p className="text-sm text-navy-800/65">
          این جدول معامله خودکار نیست. اعمال بازچینش همچنان با دکمهٔ جدا و تأیید شما انجام می‌شود.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-navy-800/55">
                <th className="py-2 text-start">کلاس</th>
                <th className="py-2 text-start">فعلی</th>
                <th className="py-2 text-start">هدف</th>
                <th className="py-2 text-start">تفاوت</th>
                <th className="py-2 text-start">اقدام</th>
              </tr>
            </thead>
            <tbody>
              {data.plan.lines.map((line) => (
                <tr key={line.asset} className="border-t border-navy-900/10">
                  <td className="py-2">{line.labelFa}</td>
                  <td className="py-2">{formatNum(line.currentPct)}٪</td>
                  <td className="py-2">{formatNum(line.targetPct)}٪</td>
                  <td className="py-2" dir="ltr">
                    {formatNum(line.diffPct)}
                  </td>
                  <td className="py-2">{ACTION_FA[line.action]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-7 text-navy-800/75">{data.plan.lines[0]?.reasonFa}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="font-semibold">چرا این امتیاز ریسک</h3>
          {data.risk.parts.map((p) => (
            <button
              key={p.code}
              type="button"
              className="block w-full rounded-lg px-2 py-1 text-start text-sm hover:bg-navy-50"
              onClick={() => setOpen(open === p.code ? null : p.code)}
            >
              <span className="font-medium">{p.labelFa}: </span>
              {p.level ? LEVEL_FA[p.level] : 'محاسبه نشد'}
              {open === p.code && <span className="mt-1 block text-navy-800/70">{p.detailFa}</span>}
            </button>
          ))}
          <p className="text-xs text-navy-800/55">{data.risk.drawdown.noteFa}</p>
          {data.risk.drawdown.pct != null && (
            <p className="text-sm">افت ثبت‌شده: {formatNum(data.risk.drawdown.pct)} درصد</p>
          )}
        </div>
        <div className="card space-y-2">
          <h3 className="font-semibold">اجزای سلامت</h3>
          {data.health.parts.map((p) => (
            <button
              key={p.code}
              type="button"
              className="block w-full rounded-lg px-2 py-1 text-start text-sm hover:bg-navy-50"
              onClick={() => setOpen(open === `h-${p.code}` ? null : `h-${p.code}`)}
            >
              <span className="font-medium">{p.labelFa}: </span>
              {p.score.toLocaleString('fa-IR')}
              {open === `h-${p.code}` && <span className="mt-1 block text-navy-800/70">{p.detailFa}</span>}
            </button>
          ))}
          <p className="text-sm text-navy-800/70">
            افق {HORIZON_FA[data.dna.horizon]} · ریسک اعلام‌شده {data.dna.riskScore.toLocaleString('fa-IR')} از ۱۰
            {data.dna.maxDrawdownPct != null
              ? ` · حداکثر افت قابل قبول ${data.dna.maxDrawdownPct.toLocaleString('fa-IR')} درصد`
              : ''}
          </p>
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold">مقایسه با دلار و طلا</h3>
        <p className="text-sm text-navy-800/70">{data.benchmark.noteFa}</p>
        {data.benchmark.enough && (
          <ul className="text-sm leading-7">
            <li>تغییر ارزش ثبت‌شدهٔ سبد: {fmtPct(data.benchmark.portfolioPct)}</li>
            <li>تغییر دلار در رکوردهای موجود: {fmtPct(data.benchmark.usdPct)}</li>
            <li>تغییر طلا در رکوردهای موجود: {fmtPct(data.benchmark.goldPct)}</li>
          </ul>
        )}
      </div>

      <form onSubmit={runScenario} className="card space-y-3">
        <h3 className="font-semibold">سناریو</h3>
        <p className="text-sm text-navy-800/65">فرض شما روی همان کلاس، بدون همبستگی. نتیجه قطعی نیست.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            دلار (درصد)
            <input className="input mt-1" dir="ltr" value={shocks.usdPct} onChange={(e) => setShocks({ ...shocks, usdPct: e.target.value })} />
          </label>
          <label className="text-sm">
            سهام (درصد)
            <input className="input mt-1" dir="ltr" value={shocks.equityPct} onChange={(e) => setShocks({ ...shocks, equityPct: e.target.value })} />
          </label>
          <label className="text-sm">
            طلا (درصد)
            <input className="input mt-1" dir="ltr" value={shocks.goldPct} onChange={(e) => setShocks({ ...shocks, goldPct: e.target.value })} />
          </label>
        </div>
        <button className="btn-secondary w-fit" type="submit">
          برآورد اثر مستقیم
        </button>
        {scenario && <p className="text-sm leading-7">{scenario}</p>}
      </form>

      {history.length > 0 && (
        <div className="card space-y-2">
          <h3 className="font-semibold">تاریخچهٔ تشخیص</h3>
          <ul className="space-y-1 text-sm">
            {history.map((row) => {
              const moves = (row.payload?.plan ?? []).filter((line) => line.action !== 'HOLD').slice(0, 2);
              return (
                <li key={row.id}>
                  {formatShamsiDate(row.createdAt, 'medium')} — {row.labelFa}
                  {moves.length > 0 && (
                    <span className="text-navy-800/70">
                      {' '}
                      {moves.map((line) => `${line.labelFa} ${formatNum(line.diffPct)}`).join('، ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function fmtPct(n: number | null) {
  if (n == null) return 'داده کافی نیست';
  return `${formatNum(n)} درصد`;
}
