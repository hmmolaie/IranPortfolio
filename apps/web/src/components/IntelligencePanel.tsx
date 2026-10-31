'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, formatNum } from '@/lib/api';

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

const ACTION_FA = { INCREASE: 'افزایش', DECREASE: 'کاهش', HOLD: 'بدون تغییر' };
const HORIZON_FA = { SHORT: 'کوتاه', MEDIUM: 'میان‌مدت', LONG: 'بلند' };
const LEVEL_FA: Record<string, string> = { LOW: 'کم', MEDIUM: 'متوسط', HIGH: 'زیاد' };

type ShockDir = 'up' | 'down';
type Shock = { dir: ShockDir; pct: string };
type Shocks = { usdPct: Shock; equityPct: Shock; goldPct: Shock };

const SHOCK_FIELDS: Array<{ key: keyof Shocks; title: string }> = [
  { key: 'usdPct', title: 'دلار' },
  { key: 'equityPct', title: 'سهام' },
  { key: 'goldPct', title: 'طلا' },
];

const SCENARIO_PRESETS: Array<{ label: string; shocks: Shocks }> = [
  {
    label: 'دلار ۳۰ درصد بالا برود',
    shocks: {
      usdPct: { dir: 'up', pct: '30' },
      equityPct: { dir: 'up', pct: '' },
      goldPct: { dir: 'up', pct: '' },
    },
  },
  {
    label: 'دلار ۲۰ درصد پایین بیاید',
    shocks: {
      usdPct: { dir: 'down', pct: '20' },
      equityPct: { dir: 'up', pct: '' },
      goldPct: { dir: 'up', pct: '' },
    },
  },
  {
    label: 'سهام ۲۰ درصد پایین بیاید',
    shocks: {
      usdPct: { dir: 'up', pct: '' },
      equityPct: { dir: 'down', pct: '20' },
      goldPct: { dir: 'up', pct: '' },
    },
  },
  {
    label: 'سهام ۱۵ درصد بالا برود',
    shocks: {
      usdPct: { dir: 'up', pct: '' },
      equityPct: { dir: 'up', pct: '15' },
      goldPct: { dir: 'up', pct: '' },
    },
  },
  {
    label: 'طلا ۲۰ درصد بالا برود',
    shocks: {
      usdPct: { dir: 'up', pct: '' },
      equityPct: { dir: 'up', pct: '' },
      goldPct: { dir: 'up', pct: '20' },
    },
  },
  {
    label: 'طلا ۱۰ درصد پایین بیاید',
    shocks: {
      usdPct: { dir: 'up', pct: '' },
      equityPct: { dir: 'up', pct: '' },
      goldPct: { dir: 'down', pct: '10' },
    },
  },
];

function parsePct(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/,/g, '.')
    .replace(/٫/g, '.');
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function signedShock(shock: Shock): number | null {
  const n = parsePct(shock.pct);
  if (n == null || n === 0) return null;
  const capped = shock.dir === 'down' ? Math.min(n, 80) : Math.min(n, 200);
  return shock.dir === 'down' ? -capped : capped;
}

function assumptionFa(title: string, shock: Shock): string | null {
  const n = parsePct(shock.pct);
  if (n == null || n === 0) return null;
  const amount = shock.dir === 'down' ? Math.min(n, 80) : Math.min(n, 200);
  return `${title} ${formatNum(amount)} درصد ${shock.dir === 'up' ? 'بالا برود' : 'پایین بیاید'}`;
}

export function IntelligencePanel({ portfolioId }: { portfolioId: string }) {
  const [data, setData] = useState<Report | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [shocks, setShocks] = useState<Shocks>({
    usdPct: { dir: 'up', pct: '' },
    equityPct: { dir: 'down', pct: '' },
    goldPct: { dir: 'up', pct: '' },
  });
  const [scenario, setScenario] = useState<{ assumptions: string[]; impactFa: string } | null>(null);
  const [scenarioError, setScenarioError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<Report>(`/intelligence/portfolios/${portfolioId}`)
      .then((report) => setData(report))
      .catch((e) => setError((e as Error).message));
  }, [portfolioId]);

  async function runScenario(next: Shocks) {
    setScenario(null);
    setScenarioError('');
    const assumptions = SHOCK_FIELDS.map((field) => assumptionFa(field.title, next[field.key])).filter(
      (line): line is string => Boolean(line),
    );
    if (!assumptions.length) {
      setScenarioError('برای دلار، سهام یا طلا جهت و درصد را مشخص کنید.');
      return;
    }
    const body: Record<string, number> = {};
    for (const field of SHOCK_FIELDS) {
      const signed = signedShock(next[field.key]);
      if (signed != null) body[field.key] = signed;
    }
    try {
      const res = await api<{
        enough: boolean;
        impactPct: number | null;
        noteFa: string;
      }>(`/intelligence/portfolios/${portfolioId}/scenario`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.enough || res.impactPct == null) {
        setScenarioError(res.noteFa);
        return;
      }
      const impactFa =
        res.impactPct > 0
          ? `با این فرض، ارزش سبد حدود ${formatNum(res.impactPct)} درصد بالا می‌رود.`
          : res.impactPct < 0
            ? `با این فرض، ارزش سبد حدود ${formatNum(Math.abs(res.impactPct))} درصد پایین می‌آید.`
            : 'با این فرض، اثر مستقیمی روی ارزش سبد دیده نمی‌شود.';
      setScenario({ assumptions, impactFa });
    } catch (err) {
      setScenarioError((err as Error).message);
    }
  }

  function onScenarioSubmit(e: FormEvent) {
    e.preventDefault();
    void runScenario(shocks);
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
            <div className="text-xs text-navy-800/55">ریسک بازار</div>
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
            اطمینان ریسک: {Math.round(data.regime.confidence * 100).toLocaleString('fa-IR')} درصد
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

      <form onSubmit={onScenarioSubmit} className="card space-y-4">
        <div>
          <h3 className="font-semibold">سناریو</h3>
          <p className="mt-2 text-sm leading-7 text-navy-800/70">
            برای هر دارایی مشخص کنید قیمت بالا برود یا پایین بیاید، و چند درصد. فیلد خالی در محاسبه نمی‌آید.
            عدد منفی لازم نیست.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCENARIO_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="rounded-full border border-navy-900/15 px-3 py-1.5 text-sm text-navy-900 hover:bg-navy-50"
              onClick={() => {
                setShocks(preset.shocks);
                void runScenario(preset.shocks);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {SHOCK_FIELDS.map((field) => {
            const shock = shocks[field.key];
            const line = assumptionFa(field.title, shock);
            return (
              <div key={field.key} className="rounded-xl border border-navy-900/10 px-3 py-3">
                <div className="font-medium">{field.title}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      shock.dir === 'up'
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                        : 'border-navy-900/15 text-navy-800/70'
                    }`}
                    onClick={() => setShocks({ ...shocks, [field.key]: { ...shock, dir: 'up' } })}
                  >
                    بالا برود
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      shock.dir === 'down'
                        ? 'border-red-700 bg-red-50 text-red-800'
                        : 'border-navy-900/15 text-navy-800/70'
                    }`}
                    onClick={() => setShocks({ ...shocks, [field.key]: { ...shock, dir: 'down' } })}
                  >
                    پایین بیاید
                  </button>
                </div>
                <label className="mt-3 block text-sm">
                  چند درصد
                  <input
                    className="input mt-1"
                    dir="ltr"
                    inputMode="decimal"
                    min={0}
                    max={shock.dir === 'down' ? 80 : 200}
                    value={shock.pct}
                    placeholder="مثلاً ۲۰"
                    onChange={(e) => setShocks({ ...shocks, [field.key]: { ...shock, pct: e.target.value } })}
                  />
                </label>
                <p className="mt-2 text-sm leading-6 text-navy-800/70">
                  {line ?? 'این مورد در سناریو نمی‌آید.'}
                </p>
              </div>
            );
          })}
        </div>
        <button className="btn-secondary w-fit" type="submit">
          برآورد اثر روی سبد
        </button>
        {scenarioError && <p className="text-sm leading-7 text-red-700">{scenarioError}</p>}
        {scenario && (
          <div className="rounded-xl bg-navy-50 px-4 py-3 text-sm leading-7">
            <p className="font-medium">فرض این سناریو</p>
            <ul className="mt-1 list-disc pe-5">
              {scenario.assumptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2">{scenario.impactFa}</p>
            <p className="mt-1 text-navy-800/60">
              این فقط اثر مستقیم همان فرض روی سهم همان دارایی در سبد است و آینده را تضمین نمی‌کند.
            </p>
          </div>
        )}
      </form>
    </section>
  );
}

function fmtPct(n: number | null) {
  if (n == null) return 'داده کافی نیست';
  return `${formatNum(n)} درصد`;
}
