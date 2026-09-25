'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ASSET_TYPE_LABELS_FA, AssetType } from '@sabadyar/shared';
import { api, formatNum, formatRial, getToken } from '@/lib/api';
import { PortfolioPieChart } from '@/components/PortfolioPieChart';
import { ConfirmDeletePortfolioModal } from '@/components/ConfirmDeletePortfolioModal';
import { useToast } from '@/components/Toast';
import { formatShamsiDate, formatShamsiDateTime } from '@/lib/shamsi-date';
import { IntelligencePanel } from '@/components/IntelligencePanel';

type Item = {
  id: string;
  symbol: string;
  assetType: string;
  weightPct: number;
  quantity: number;
  amountRial: number;
  reasonFa: string;
  unitPrice?: number | null;
  avgBuyPrice?: number | null;
  lastPrice?: number | null;
  costBasisRial?: number | null;
  marketValueRial?: number | null;
  feeRial?: number | null;
  pnlRial?: number | null;
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
  createdAt: string;
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

type AnalysisSuggestion = {
  titleFa: string;
  bodyFa: string;
  priority?: string;
  action?: 'ADD' | 'INCREASE' | 'DECREASE' | 'REMOVE' | 'SET' | 'SKIP';
  symbol?: string;
  assetType?: string;
  quantity?: number;
  amountRial?: number;
  weightPct?: number;
};

type AnalysisResult = {
  score: number;
  summaryFa: string;
  strengthsFa: string[];
  weaknessesFa: string[];
  suggestions: AnalysisSuggestion[];
  analyzedAt: string;
};

const ADDABLE_TYPES = Object.values(AssetType);

/** پیشنهاد چند استراتژی فعلاً از UI پنهان است. */
const SHOW_MULTI_STRATEGY = false;

function parseUserNumber(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)))
    .replace(/,/g, '')
    .replace(/٫/g, '.');
  if (!normalized) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

type HoldingEdit = { qty: string; amount: string; last: 'qty' | 'amount' };

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [p, setP] = useState<Portfolio | null>(null);
  const [busy, setBusy] = useState('');
  const [cashAmount, setCashAmount] = useState('100000000');

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [strategies, setStrategies] = useState<StrategyOption[] | null>(null);
  const [strategiesBusy, setStrategiesBusy] = useState(false);

  const [newSymbol, setNewSymbol] = useState('');
  const [newAssetType, setNewAssetType] = useState<AssetType>(AssetType.STOCK);
  const [addBy, setAddBy] = useState<'qty' | 'amount'>('qty');
  const [newQty, setNewQty] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [edits, setEdits] = useState<Record<string, HoldingEdit>>({});

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<number[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const data = await api<Portfolio>(`/portfolios/${id}`);
    setP(data);
  }

  /** وزن٪ نمایشی: سهم مبلغ از کل ارزش تخصیص‌یافته سبد */
  function displayWeightPct(amountRial: number, totalRial: number) {
    if (!totalRial || totalRial <= 0) return 0;
    return Math.round((amountRial / totalRial) * 1000) / 10;
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

  async function addSymbol(e: FormEvent) {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    const quantity = addBy === 'qty' ? parseUserNumber(newQty) : null;
    const amountRial = addBy === 'amount' ? parseUserNumber(newAmount) : null;
    if (addBy === 'qty' && quantity == null) {
      toast.error('تعداد سهم را وارد کنید.');
      return;
    }
    if (addBy === 'amount' && amountRial == null) {
      toast.error('مبلغ کل خرید را وارد کنید.');
      return;
    }
    setBusy('add');
    try {
      await api(`/portfolios/${id}/items`, {
        method: 'POST',
        body: JSON.stringify({
          symbol: newSymbol.trim(),
          assetType: newAssetType,
          ...(addBy === 'qty' ? { quantity } : { amountRial }),
        }),
      });
      setNewSymbol('');
      setNewQty('');
      setNewAmount('');
      await load();
      toast.success('نماد اضافه شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  function rowEdit(item: Item): HoldingEdit {
    return (
      edits[item.symbol] ?? {
        qty: String(item.quantity ?? ''),
        amount: String(item.amountRial ?? ''),
        last: 'qty',
      }
    );
  }

  function patchRowEdit(item: Item, patch: Partial<HoldingEdit>) {
    setEdits((prev) => ({
      ...prev,
      [item.symbol]: {
        ...(prev[item.symbol] ?? {
          qty: String(item.quantity ?? ''),
          amount: String(item.amountRial ?? ''),
          last: 'qty' as const,
        }),
        ...patch,
      },
    }));
  }

  async function saveHolding(item: Item) {
    const edit = rowEdit(item);
    const body =
      edit.last === 'qty'
        ? { quantity: parseUserNumber(edit.qty) }
        : { amountRial: parseUserNumber(edit.amount) };
    const value = edit.last === 'qty' ? body.quantity : body.amountRial;
    if (value == null) {
      toast.error(
        edit.last === 'qty' ? 'تعداد سهم را درست وارد کنید.' : 'مبلغ کل را درست وارد کنید.',
      );
      return;
    }
    setBusy(`edit:${item.symbol}`);
    try {
      await api(`/portfolios/${id}/items/${encodeURIComponent(item.symbol)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setEdits((prev) => {
        const next = { ...prev };
        delete next[item.symbol];
        return next;
      });
      await load();
      toast.success('موقعیت به‌روز شد.');
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
    setAppliedSuggestions([]);
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

  async function applyOneSuggestion(s: AnalysisSuggestion, index: number) {
    if (s.action === 'SKIP' || appliedSuggestions.includes(index)) return;
    setBusy(`apply-sugg:${index}`);
    try {
      await api(`/portfolios/${id}/apply-suggestion`, {
        method: 'POST',
        body: JSON.stringify({
          titleFa: s.titleFa,
          bodyFa: s.bodyFa,
          ...(s.priority ? { priority: s.priority } : {}),
          ...(s.action ? { action: s.action } : {}),
          ...(s.symbol ? { symbol: s.symbol } : {}),
          ...(s.assetType ? { assetType: s.assetType } : {}),
          ...(s.quantity != null ? { quantity: s.quantity } : {}),
          ...(s.amountRial != null ? { amountRial: s.amountRial } : {}),
          ...(s.weightPct != null ? { weightPct: s.weightPct } : {}),
        }),
      });
      setAppliedSuggestions((prev) => [...prev, index]);
      await load();
      toast.success('پیشنهاد روی سبد اعمال شد.');
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
    ? latest.items.reduce((s, i) => s + (i.marketValueRial ?? i.amountRial ?? 0), 0)
    : 0;
  const costBasisTotal = latest
    ? latest.items.reduce((s, i) => {
        const avg = i.avgBuyPrice ?? i.unitPrice;
        const cost = i.costBasisRial ?? (avg != null ? avg * i.quantity : 0);
        return s + (cost || 0);
      }, 0)
    : 0;
  const feeTotal = latest
    ? latest.items.reduce((s, i) => s + (i.feeRial ?? 0), 0)
    : 0;
  const pnlTotal = latest
    ? latest.items.reduce((s, i) => s + (i.pnlRial ?? 0), 0)
    : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{p.name}</h1>
          <p className="mt-1 text-sm text-navy-800/55">
            تاریخ تشکیل {formatShamsiDate(p.createdAt, 'long')}
          </p>
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
          {SHOW_MULTI_STRATEGY && (
            <button
              className="btn-primary"
              disabled
              onClick={loadStrategies}
            >
              پیشنهاد چند استراتژی AI
            </button>
          )}
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

      <IntelligencePanel portfolioId={id} />

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
              {analysis.suggestions.map((s, i) => {
                const applied = appliedSuggestions.includes(i);
                const skip = s.action === 'SKIP';
                const rowBusy = busy === `apply-sugg:${i}`;
                return (
                  <article
                    key={i}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-navy-50/80 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.titleFa}</div>
                      <p className="mt-1 text-sm leading-7 text-navy-800/75">{s.bodyFa}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                      disabled={!!busy || skip || applied || !latest}
                      title={
                        skip ? 'این مورد فقط راهنمایی است و معاملهٔ مشخصی ندارد' : undefined
                      }
                      onClick={() => applyOneSuggestion(s, i)}
                    >
                      {rowBusy ? '...' : applied ? 'اعمال شد' : 'انجام شود'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          <div className="flex flex-col items-start gap-2 border-t border-navy-900/10 pt-4">
            <p className="text-sm text-navy-800/65">
              اگر می‌خواهید سبد با توجه به پیشنهادهای بالا بازچینش شود، از دکمهٔ زیر استفاده کنید.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={!!busy || !latest}
              onClick={() => run('rebalance', `/portfolios/${id}/rebalance`)}
            >
              {busy === 'rebalance' ? '...' : 'بازچینش بر اساس این پیشنهادها'}
            </button>
          </div>
        </section>
      )}

      {SHOW_MULTI_STRATEGY && strategies && strategies.length > 0 && (
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
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-navy-800/65">
              اگر به‌جای انتخاب یکی از کارت‌ها می‌خواهید سبد یک‌جا با AI بازچینش شود:
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={!!busy || !latest}
                onClick={() => run('rebalance', `/portfolios/${id}/rebalance`)}
              >
                {busy === 'rebalance' ? '...' : 'بازچینش سبد'}
              </button>
              <button
                type="button"
                className="text-sm text-navy-800/60 hover:underline"
                onClick={() => setStrategies(null)}
              >
                بستن
              </button>
            </div>
          </div>
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
            <PortfolioPieChart
              items={latest.items.map((i) => ({
                symbol: i.symbol,
                weightPct: displayWeightPct(i.marketValueRial ?? i.amountRial, itemsTotal),
              }))}
            />
          </div>

          <div className="overflow-x-auto">
            <p className="mb-3 text-xs leading-6 text-navy-800/60">
              در هر ردیف تعداد یا مبلغ را عوض کنید و ذخیره کنید. فیلد دیگر از آخرین قیمت دیتابیس حساب
              می‌شود. وزن٪ فقط نمایشی است. سود و زیان پس از کسر کارمزد خرید روی بهای تمام‌شده و
              کارمزد فروش روی ارزش روز است.
            </p>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-navy-900/10 text-start">
                  <th className="py-2 pe-4 font-medium">نماد</th>
                  <th className="py-2 pe-4 font-medium">نوع</th>
                  <th className="py-2 pe-4 font-medium">وزن٪</th>
                  <th className="py-2 pe-4 font-medium">تعداد</th>
                  <th className="py-2 pe-4 font-medium">مبلغ (ریال)</th>
                  <th className="py-2 pe-4 font-medium">میانگین خرید</th>
                  <th className="py-2 pe-4 font-medium">آخرین قیمت</th>
                  <th className="py-2 pe-4 font-medium">کارمزد</th>
                  <th className="py-2 pe-4 font-medium">سود/زیان</th>
                  <th className="py-2 pe-4 font-medium">دلیل</th>
                  <th className="py-2 font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {latest.items.map((i) => {
                  const market = i.marketValueRial ?? i.amountRial;
                  const avg = i.avgBuyPrice ?? i.unitPrice ?? null;
                  const last = i.lastPrice ?? null;
                  const fee = i.feeRial ?? 0;
                  const pnl = i.pnlRial ?? (avg != null && last != null ? (last - avg) * i.quantity - fee : 0);
                  const edit = rowEdit(i);
                  const rowBusy = busy === `edit:${i.symbol}`;
                  return (
                    <tr key={i.id} className="border-b border-navy-900/5 align-top">
                      <td className="py-3 pe-4 font-medium">{i.symbol}</td>
                      <td className="py-3 pe-4 text-xs text-navy-800/60">
                        {ASSET_TYPE_LABELS_FA[i.assetType as AssetType] ?? i.assetType}
                      </td>
                      <td className="py-3 pe-4 tabular-nums text-navy-800/90">
                        {formatNum(displayWeightPct(market, itemsTotal))}٪
                      </td>
                      <td className="py-3 pe-4">
                        <input
                          className="input min-w-[6.5rem] py-1 text-xs tabular-nums"
                          inputMode="decimal"
                          value={edit.qty}
                          disabled={!!busy}
                          onChange={(e) =>
                            patchRowEdit(i, { qty: e.target.value, last: 'qty' })
                          }
                          aria-label={`تعداد ${i.symbol}`}
                        />
                      </td>
                      <td className="py-3 pe-4">
                        <input
                          className="input min-w-[8rem] py-1 text-xs tabular-nums"
                          inputMode="decimal"
                          value={edit.amount}
                          disabled={!!busy}
                          onChange={(e) =>
                            patchRowEdit(i, { amount: e.target.value, last: 'amount' })
                          }
                          aria-label={`مبلغ ${i.symbol}`}
                        />
                      </td>
                      <td className="py-3 pe-4 tabular-nums">
                        {avg != null ? formatRial(avg) : '—'}
                      </td>
                      <td className="py-3 pe-4 tabular-nums">
                        {last != null ? formatRial(last) : '—'}
                      </td>
                      <td className="py-3 pe-4 tabular-nums text-navy-800/80">{formatRial(fee)}</td>
                      <td
                        className={`py-3 pe-4 tabular-nums font-medium ${
                          pnl > 0 ? 'text-emerald-800' : pnl < 0 ? 'text-red-700' : 'text-navy-800/70'
                        }`}
                      >
                        {formatRial(pnl)}
                      </td>
                      <td className="py-3 pe-4 leading-6 text-navy-800/75">{i.reasonFa}</td>
                      <td className="py-3">
                        <div className="flex flex-col items-start gap-1">
                          <button
                            type="button"
                            className="text-xs text-navy-900 hover:underline disabled:opacity-40"
                            disabled={!!busy || !edits[i.symbol]}
                            onClick={() => saveHolding(i)}
                          >
                            {rowBusy ? '...' : 'ذخیره'}
                          </button>
                          <span className="text-[10px] text-navy-800/45">
                            {edit.last === 'qty' ? 'بر اساس تعداد' : 'بر اساس مبلغ'}
                          </span>
                          <button
                            type="button"
                            className="text-xs text-red-700 hover:underline"
                            disabled={!!busy}
                            onClick={() => removeSymbol(i.symbol)}
                          >
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy-900/15 bg-navy-50/60">
                  <td className="py-3 pe-4 font-semibold" colSpan={2}>
                    جمع
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums">
                    {itemsTotal > 0 ? `${formatNum(100)}٪` : '—'}
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums">
                    {formatNum(latest.items.reduce((s, i) => s + (i.quantity || 0), 0))}
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums">
                    {formatRial(
                      latest.items.reduce((s, i) => s + (i.amountRial || 0), 0),
                    )}
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums text-navy-900">
                    <div className="text-[10px] font-normal text-navy-800/45">بهای تمام‌شده</div>
                    {formatRial(costBasisTotal)}
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums text-navy-900">
                    <div className="text-[10px] font-normal text-navy-800/45">ارزش روز</div>
                    {formatRial(itemsTotal)}
                  </td>
                  <td className="py-3 pe-4 font-semibold tabular-nums text-navy-900">
                    {formatRial(feeTotal)}
                  </td>
                  <td
                    className={`py-3 pe-4 font-semibold tabular-nums ${
                      pnlTotal > 0
                        ? 'text-emerald-800'
                        : pnlTotal < 0
                          ? 'text-red-700'
                          : 'text-navy-900'
                    }`}
                  >
                    {formatRial(pnlTotal)}
                  </td>
                  <td className="py-3 pe-4 text-xs text-navy-800/55" colSpan={2}>
                    سقف سرمایه: {formatRial(p.capitalRial)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <form
            onSubmit={addSymbol}
            className="grid gap-3 border-t border-navy-900/10 pt-4 sm:grid-cols-2 lg:grid-cols-5"
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
              <label className="label">ورود با</label>
              <select
                className="input"
                value={addBy}
                onChange={(e) => setAddBy(e.target.value as 'qty' | 'amount')}
              >
                <option value="qty">تعداد سهم</option>
                <option value="amount">مبلغ کل (ریال)</option>
              </select>
            </div>
            <div>
              <label className="label">
                {addBy === 'qty' ? 'تعداد' : 'مبلغ کل (ریال)'}
              </label>
              <input
                className="input"
                inputMode="decimal"
                value={addBy === 'qty' ? newQty : newAmount}
                onChange={(e) =>
                  addBy === 'qty' ? setNewQty(e.target.value) : setNewAmount(e.target.value)
                }
                placeholder={addBy === 'qty' ? 'مثلاً ۱۰۰' : 'مثلاً ۵۰۰۰۰۰۰۰'}
                required
              />
            </div>
            <div className="flex items-end">
              <button type="submit" className="btn-primary w-full" disabled={!!busy || !latest}>
                {busy === 'add' ? '...' : 'افزودن به سبد'}
              </button>
            </div>
            <p className="text-xs leading-6 text-navy-800/55 sm:col-span-2 lg:col-span-5">
              یکی از تعداد یا مبلغ را بدهید؛ دیگری از آخرین قیمت دیتابیس حساب می‌شود. وزن٪ لازم نیست.
            </p>
          </form>
        </section>
      )}

      <section className="card flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">گفتگو دربارهٔ سبد</h2>
            <p className="mt-1 text-sm text-navy-800/60">
              دربارهٔ ترکیب سبد، محدودیت‌ها، و وضعیت سهام یا دلار و طلا بپرسید — حتی اگر آن نماد الان در
              سبد نباشد. قیمت از دیتابیس خوانده می‌شود و ترجیحات شما ذخیره می‌گردد.
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
              هنوز پیامی نیست. مثلاً بپرسید: «وضعیت شپنا چطور است؟» یا «دلار و طلا امروز چه قیمتی دارند؟»
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
            placeholder="مثلاً وضعیت شپنا، دلار یا طلا..."
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
                {formatShamsiDateTime(e.createdAt)}
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
