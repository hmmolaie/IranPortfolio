'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken } from '@/lib/api';

type Item = {
  id: string;
  symbol: string;
  assetType: string;
  weightPct: number;
  quantity: number;
  amountRial: number;
  reasonFa: string;
};

type Snapshot = {
  id: string;
  kind: string;
  strategySummaryFa?: string | null;
  performancePct?: number | null;
  items: Item[];
  createdAt: string;
};

type Portfolio = {
  id: string;
  name: string;
  strategy: string;
  capitalRial: number;
  cashRial: number;
  snapshots: Snapshot[];
  events: Array<{ id: string; type: string; noteFa?: string | null; createdAt: string }>;
};

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<Portfolio | null>(null);
  const [busy, setBusy] = useState('');
  const [editWeights, setEditWeights] = useState<Record<string, string>>({});
  const [cashAmount, setCashAmount] = useState('100000000');
  const [msg, setMsg] = useState('');

  async function load() {
    const data = await api<Portfolio>(`/portfolios/${id}`);
    setP(data);
    const latest = data.snapshots[0];
    if (latest) {
      const map: Record<string, string> = {};
      latest.items.forEach((i) => {
        map[i.symbol] = String(Math.round(i.weightPct * 10) / 10);
      });
      setEditWeights(map);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => router.replace('/portfolios'));
  }, [id, router]);

  async function run(action: string, path: string, body?: unknown) {
    setBusy(action);
    setMsg('');
    try {
      await api(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
      setMsg('انجام شد.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function saveAdjust() {
    if (!p?.snapshots[0]) return;
    const items = Object.entries(editWeights).map(([symbol, weightPct]) => ({
      symbol,
      weightPct: Number(weightPct),
    }));
    await run('adjust', `/portfolios/${id}/adjust`, { items });
  }

  if (!p) return <p className="text-navy-800/60">در حال بارگذاری...</p>;
  const latest = p.snapshots[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{p.name}</h1>
          <p className="mt-2 text-navy-800/70">
            سرمایه {formatRial(p.capitalRial)} · نقد {formatRial(p.cashRial)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={!!busy}
            onClick={() => run('suggest', `/portfolios/${id}/suggest`)}
          >
            {busy === 'suggest' ? '...' : 'پیشنهاد AI'}
          </button>
          <button
            className="btn-secondary"
            disabled={!!busy}
            onClick={() => run('rebalance', `/portfolios/${id}/rebalance`)}
          >
            بازچینش
          </button>
          <button
            className="btn-secondary"
            disabled={!!busy}
            onClick={() => run('monthly', `/portfolios/${id}/monthly-evaluate`)}
          >
            ارزیابی ماهانه
          </button>
        </div>
      </div>

      {msg && <p className="text-sm">{msg}</p>}

      {latest && (
        <section className="card space-y-4">
          <div>
            <div className="text-xs text-navy-800/50">{latest.kind}</div>
            <h2 className="mt-1 text-lg font-semibold">استراتژی و چرایی</h2>
            <p className="mt-2 leading-7 text-navy-800/80">{latest.strategySummaryFa}</p>
            {latest.performancePct != null && (
              <p className="mt-2 text-sm">بازده برآوردی: {formatNum(latest.performancePct)}٪</p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-navy-900/10 text-start">
                  <th className="py-2 pe-4 font-medium">نماد</th>
                  <th className="py-2 pe-4 font-medium">وزن٪</th>
                  <th className="py-2 pe-4 font-medium">مقدار</th>
                  <th className="py-2 pe-4 font-medium">مبلغ</th>
                  <th className="py-2 font-medium">دلیل</th>
                </tr>
              </thead>
              <tbody>
                {latest.items.map((i) => (
                  <tr key={i.id} className="border-b border-navy-900/5 align-top">
                    <td className="py-3 pe-4 font-medium">{i.symbol}</td>
                    <td className="py-3 pe-4">
                      <input
                        className="input w-20"
                        value={editWeights[i.symbol] ?? ''}
                        onChange={(e) =>
                          setEditWeights((prev) => ({ ...prev, [i.symbol]: e.target.value }))
                        }
                      />
                    </td>
                    <td className="py-3 pe-4">{formatNum(i.quantity)}</td>
                    <td className="py-3 pe-4">{formatRial(i.amountRial)}</td>
                    <td className="py-3 leading-6 text-navy-800/75">{i.reasonFa}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn-secondary" onClick={saveAdjust} disabled={!!busy}>
            ذخیره تغییرات وزن
          </button>
        </section>
      )}

      <section className="card grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="label">مبلغ (ریال)</label>
          <input className="input" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <button
            className="btn-secondary"
            onClick={() =>
              run('deposit', `/portfolios/${id}/cash`, {
                type: 'DEPOSIT_CASH',
                amountRial: Number(cashAmount),
              })
            }
          >
            واریز نقد + بازچینش
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              run('sell', `/portfolios/${id}/cash`, {
                type: 'SELL',
                amountRial: Number(cashAmount),
                symbol: latest?.items[0]?.symbol,
              })
            }
          >
            ثبت فروش + بازچینش
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold">رویدادها</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {p.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-4 border-b border-navy-900/5 py-2">
              <span>{e.noteFa ?? e.type}</span>
              <span className="text-navy-800/50">
                {new Date(e.createdAt).toLocaleString('fa-IR')}
              </span>
            </li>
          ))}
          {p.events.length === 0 && <li className="text-navy-800/50">رویدادی ثبت نشده</li>}
        </ul>
      </section>
    </div>
  );
}
