'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ASSET_TYPE_LABELS_FA, AssetType } from '@sabadyar/shared';
import { api, formatNum, formatRial, getToken } from '@/lib/api';
import { PortfolioPieChart } from '@/components/PortfolioPieChart';
import { ConfirmDeletePortfolioModal } from '@/components/ConfirmDeletePortfolioModal';
import { useToast } from '@/components/Toast';

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

type AnalysisResult = {
  score: number;
  summaryFa: string;
  strengthsFa: string[];
  weaknessesFa: string[];
  suggestions: Array<{ titleFa: string; bodyFa: string; priority?: string }>;
  analyzedAt: string;
};

const ADDABLE_TYPES = Object.values(AssetType);

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState<Portfolio | null>(null);
  const [busy, setBusy] = useState('');
  const [editWeights, setEditWeights] = useState<Record<string, string>>({});
  const [cashAmount, setCashAmount] = useState('100000000');

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [strategies, setStrategies] = useState<StrategyOption[] | null>(null);
  const [strategiesBusy, setStrategiesBusy] = useState(false);

  const [newSymbol, setNewSymbol] = useState('');
  const [newAssetType, setNewAssetType] = useState<AssetType>(AssetType.STOCK);
  const [newWeight, setNewWeight] = useState('5');

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      router.replace('/');
      return;
    }
    Promise.all([load(), loadChat()]).catch(() => router.replace('/portfolios'));
  }, [id, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  async function run(action: string, path: string, body?: unknown) {
    setBusy(action);
    try {
      await api(path, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
      toast.success('انجام شد.');
    } catch (e) {
      toast.error((e as Error).message);
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

  async function addSymbol(e: FormEvent) {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    setBusy('add');
    try {
      await api(`/portfolios/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          symbol: newSymbol.trim(),
          assetType: newAssetType,
          weightPct: Number(newWeight),
        }),
      });
      setNewSymbol('');
      setNewWeight('5');
      await load();
      toast.success('نماد اضافه شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function removeSymbol(symbol: string) {
    if (!confirm(`نماد «${symbol}» از سبد حذف شود؟`)) return;
    setBusy('remove');
    try {
      await api(`/portfolios/${id}/items/${encodeURIComponent(symbol)}`, {
        method: 'DELETE',
      });
      await load();
      toast.success('نماد حذف شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function clearChat() {
    if (!confirm('گفتگوهای قبلی پاک شوند؟ (در سیستم باقی می‌مانند)')) return;
    setBusy('clearChat');
    try {
      await api(`/portfolios/${id}/chat`, { method: 'DELETE' });
      setChat([]);
      toast.success('گفتگوها پاک شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function clearEvents() {
    if (!confirm('رویدادها پاک شوند؟ (در سیستم باقی می‌مانند)')) return;
    setBusy('clearEvents');
    try {
      await api(`/portfolios/${id}/events`, { method: 'DELETE' });
      await load();
      toast.success('رویدادها پاک شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function analyzePortfolio() {
    setBusy('analyze');
    setAnalysis(null);
    try {
      const res = await api<AnalysisResult>(`/portfolios/${id}/analyze`, { method: 'POST' });
      setAnalysis(res);
      toast.success('آنالیز سبد انجام شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function deletePortfolio() {
    setDeleting(true);
    try {
      await api(`/portfolios/${id}`, { method: 'DELETE' });
      toast.success('سبد حذف شد.');
      router.replace('/portfolios');
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function loadStrategies() {
    setStrategiesBusy(true);
    try {
      const out = await api<{ strategies: StrategyOption[] }>(
        `/portfolios/${id}/suggest-strategies`,
        { method: 'POST' },
      );
      setStrategies(out.strategies ?? []);
      toast.success('پیشنهادهای استراتژی آماده شد.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStrategiesBusy(false);
    }
  }

  async function applyStrategy(s: StrategyOption) {
    setBusy('apply');
    try {
      await api(`/portfolios/${id}/apply-strategy`, {
        method: 'POST',
        body: JSON.stringify(s),
      });
      setStrategies(null);
      await load();
      toast.success('استراتژی انتخاب‌شده اعمال شد.');
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.error((err as Error).message);
    } finally {
      setChatBusy(false);
    }
  }

  function onPickPhysical(type: AssetType) {
    setNewAssetType(type);
    if (type === AssetType.PHYSICAL_GOLD) setNewSymbol('PHYSICAL_GOLD');
    if (type === AssetType.PHYSICAL_USD) setNewSymbol('PHYSICAL_USD');
  }

  if (!p) return <p className="text-navy-800/60">در حال بارگذاری...</p>;
  const latest = p.snapshots[0];
  const itemsTotal = latest
    ? latest.items.reduce((s, i) => s + (i.amountRial || 0), 0)
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{p.name}</h1>
          <p className="mt-2 text-navy-800/70">
            سرمایه {formatRial(p.capitalRial)} · نقد {formatRial(p.cashRial)}
            {latest && (
              <>
                {' '}
                · ارزش تخصیص‌یافته {formatRial(itemsTotal)}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary"
            disabled={!!busy || !latest}
            onClick={analyzePortfolio}
          >
            {busy === 'analyze' ? '...' : 'آنالیز سبد جاری با AI'}
          </button>
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
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-red-700/30 bg-white px-5 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50"
            disabled={!!busy || deleting}
            onClick={() => setConfirmDelete(true)}
          >
            حذف سبد
          </button>
        </div>
      </div>

      {analysis && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">نتیجه آنالیز AI</h2>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold text-navy-900">
                {analysis.score.toLocaleString('fa-IR')}
              </span>
              <span className="text-sm text-navy-800/55">از ۱۰۰</span>
            </div>
          </div>
          <p className="leading-7 text-navy-800/85">{analysis.summaryFa}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-emerald-800">نقاط قوت</h3>
              <ul className="mt-2 list-disc space-y-1 pe-5 text-sm text-navy-800/80">
                {analysis.strengthsFa.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-red-800">نقاط ضعف</h3>
              <ul className="mt-2 list-disc space-y-1 pe-5 text-sm text-navy-800/80">
                {analysis.weaknessesFa.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          {analysis.suggestions.length > 0 && (
            <div className="space-y-2 border-t border-navy-900/10 pt-4">
              <h3 className="text-sm font-semibold">پیشنهادهای بهبود</h3>
              {analysis.suggestions.map((s, i) => (
                <article key={i} className="rounded-lg bg-navy-50/80 px-3 py-2">
                  <div className="font-medium">{s.titleFa}</div>
                  <p className="mt-1 text-sm leading-7 text-navy-800/75">{s.bodyFa}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

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
                <ul className="space-y-1 text-xs text-navy-800/70">
                  {s.items.slice(0, 6).map((i) => (
                    <li key={i.symbol}>
                      {i.symbol} — {formatNum(i.weightPct)}٪
                      {p.capitalRial > 0 && (
                        <span className="text-navy-800/45">
                          {' '}
                          (~{formatRial((i.weightPct / 100) * p.capitalRial)})
                        </span>
                      )}
                      {i.assetType === 'PHYSICAL_GOLD' || i.assetType === 'PHYSICAL_USD'
                        ? ` (${ASSET_TYPE_LABELS_FA[i.assetType as AssetType] ?? i.assetType})`
                        : ''}
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

          <div>
            <h3 className="mb-3 text-sm font-semibold">ترکیب سبد</h3>
            <PortfolioPieChart items={latest.items} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-navy-900/10 text-start">
                  <th className="py-2 pe-4 font-medium">نماد</th>
                  <th className="py-2 pe-4 font-medium">نوع</th>
                  <th className="py-2 pe-4 font-medium">وزن٪</th>
                  <th className="py-2 pe-4 font-medium">مقدار</th>
                  <th className="py-2 pe-4 font-medium">مبلغ</th>
                  <th className="py-2 pe-4 font-medium">دلیل</th>
                  <th className="py-2 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {latest.items.map((i) => (
                  <tr key={i.id} className="border-b border-navy-900/5 align-top">
                    <td className="py-3 pe-4 font-medium">{i.symbol}</td>
                    <td className="py-3 pe-4 text-xs text-navy-800/60">
                      {ASSET_TYPE_LABELS_FA[i.assetType as AssetType] ?? i.assetType}
                    </td>
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
                    <td className="py-3 pe-4 leading-6 text-navy-800/75">{i.reasonFa}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        className="text-xs text-red-700 hover:underline"
                        disabled={!!busy}
                        onClick={() => removeSymbol(i.symbol)}
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy-900/15 bg-navy-50/60">
                  <td className="py-3 pe-4 font-semibold" colSpan={4}>
                    جمع مبلغ کل سبد
                  </td>
                  <td className="py-3 pe-4 font-semibold text-navy-900">
                    {formatRial(itemsTotal)}
                  </td>
                  <td className="py-3 pe-4 text-xs text-navy-800/55" colSpan={2}>
                    سقف سرمایه: {formatRial(p.capitalRial)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={saveAdjust} disabled={!!busy}>
              ذخیره تغییرات وزن
            </button>
          </div>

          <form
            onSubmit={addSymbol}
            className="grid gap-3 border-t border-navy-900/10 pt-4 sm:grid-cols-4"
          >
            <div>
              <label className="label">نماد جدید</label>
              <input
                className="input"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                placeholder="مثلاً شپنا یا PHYSICAL_GOLD"
                required
              />
            </div>
            <div>
              <label className="label">نوع دارایی</label>
              <select
                className="input"
                value={newAssetType}
                onChange={(e) => onPickPhysical(e.target.value as AssetType)}
              >
                {ADDABLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ASSET_TYPE_LABELS_FA[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">وزن٪</label>
              <input
                className="input"
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                required
              />
            </div>
            <div className="flex items-end">
              <button type="submit" className="btn-primary w-full" disabled={!!busy || !latest}>
                {busy === 'add' ? '...' : 'افزودن به سبد'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">گفتگو دربارهٔ سبد</h2>
            <p className="mt-1 text-sm text-navy-800/60">
              دربارهٔ چرایی انتخاب سهام، محدودیت‌ها و علاقه‌مندی‌ها بپرسید؛ پاسخ‌ها و ترجیحات شما ذخیره
              می‌شود.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!!busy || chat.length === 0}
            onClick={clearChat}
          >
            {busy === 'clearChat' ? '...' : 'پاک کردن گفتگوها'}
          </button>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">رویدادها</h2>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!!busy || p.events.length === 0}
            onClick={clearEvents}
          >
            {busy === 'clearEvents' ? '...' : 'پاک کردن رویدادها'}
          </button>
        </div>
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

      {confirmDelete && (
        <ConfirmDeletePortfolioModal
          portfolioName={p.name}
          busy={deleting}
          onCancel={() => !deleting && setConfirmDelete(false)}
          onConfirm={deletePortfolio}
        />
      )}
    </div>
  );
}
