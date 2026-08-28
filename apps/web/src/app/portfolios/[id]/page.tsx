'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
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

type ChatMessage = {
  id: string;
  role: string;
  contentFa: string;
  createdAt: string;
};

type StrategyOption = {
  labelFa: string;
  strategySummaryFa: string;
  items: Array<{
    symbol: string;
    assetType: string;
    weightPct: number;
    reasonFa: string;
  }>;
};

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [p, setP] = useState<Portfolio | null>(null);
  const [busy, setBusy] = useState('');
  const [editWeights, setEditWeights] = useState<Record<string, string>>({});
  const [cashAmount, setCashAmount] = useState('100000000');
  const [msg, setMsg] = useState('');

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [strategies, setStrategies] = useState<StrategyOption[] | null>(null);
  const [strategiesBusy, setStrategiesBusy] = useState(false);

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

  async function loadChat() {
    const messages = await api<ChatMessage[]>(`/portfolios/${id}/chat`);
    setChat(messages);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    Promise.all([load(), loadChat()]).catch(() => router.replace('/portfolios'));
  }, [id, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

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

  async function loadStrategies() {
    setStrategiesBusy(true);
    setMsg('');
    try {
      const out = await api<{ strategies: StrategyOption[] }>(
        `/portfolios/${id}/suggest-strategies`,
        { method: 'POST' },
      );
      setStrategies(out.strategies ?? []);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setStrategiesBusy(false);
    }
  }

  async function applyStrategy(s: StrategyOption) {
    setBusy('apply');
    setMsg('');
    try {
      await api(`/portfolios/${id}/apply-strategy`, {
        method: 'POST',
        body: JSON.stringify(s),
      });
      setStrategies(null);
      await load();
      setMsg('استراتژی انتخاب‌شده اعمال شد.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    setChatBusy(true);
    try {
      await api<ChatMessage>(`/portfolios/${id}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      await loadChat();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setChatBusy(false);
    }
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
            disabled={!!busy || strategiesBusy}
            onClick={loadStrategies}
          >
            {strategiesBusy ? '...' : 'پیشنهاد چند استراتژی AI'}
          </button>
          <button
            className="btn-secondary"
            disabled={!!busy}
            onClick={() => run('suggest', `/portfolios/${id}/suggest`)}
          >
            {busy === 'suggest' ? '...' : 'پیشنهاد سریع'}
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

      {strategies && strategies.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">استراتژی‌های پیشنهادی</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {strategies.map((s, idx) => (
              <article key={idx} className="card flex flex-col gap-3">
                <div>
                  <h3 className="font-semibold text-navy-900">{s.labelFa}</h3>
                  <p className="mt-2 text-sm leading-7 text-navy-800/80">{s.strategySummaryFa}</p>
                </div>
                <ul className="text-xs text-navy-800/70 space-y-1">
                  {s.items.slice(0, 6).map((i) => (
                    <li key={i.symbol}>
                      {i.symbol} — {formatNum(i.weightPct)}٪
                    </li>
                  ))}
                  {s.items.length > 6 && (
                    <li className="text-navy-800/50">+ {s.items.length - 6} نماد دیگر</li>
                  )}
                </ul>
                <button
                  className="btn-primary mt-auto w-fit"
                  disabled={!!busy}
                  onClick={() => applyStrategy(s)}
                >
                  انتخاب این استراتژی
                </button>
              </article>
            ))}
          </div>
          <button className="text-sm text-navy-800/60 hover:underline" onClick={() => setStrategies(null)}>
            بستن
          </button>
        </section>
      )}

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

      <section className="card flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold">گفتگو دربارهٔ سبد</h2>
          <p className="mt-1 text-sm text-navy-800/60">
            دربارهٔ چرایی انتخاب سهام، محدودیت‌ها و علاقه‌مندی‌ها بپرسید؛ پاسخ‌ها و ترجیحات شما ذخیره
            می‌شود.
          </p>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg bg-navy-50/60 p-4">
          {chat.length === 0 && (
            <p className="text-sm text-navy-800/50">
              هنوز پیامی نیست. مثلاً بپرسید: «چرا این نمادها انتخاب شده‌اند؟»
            </p>
          )}
          {chat.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg px-3 py-2 text-sm leading-7 ${
                m.role === 'user'
                  ? 'ms-8 bg-white text-navy-900'
                  : 'me-8 bg-navy-900/90 text-white'
              }`}
            >
              {m.contentFa}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <form onSubmit={sendChat} className="flex gap-2">
          <input
            className="input flex-1"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="سؤال خود را بنویسید..."
            disabled={chatBusy}
          />
          <button type="submit" className="btn-primary" disabled={chatBusy || !chatInput.trim()}>
            {chatBusy ? '...' : 'ارسال'}
          </button>
        </form>
      </section>

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
