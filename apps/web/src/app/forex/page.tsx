'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, getToken } from '@/lib/api';
import { WaitingOverlay } from '@/components/WaitingOverlay';
import { ForexGraphView } from '@/components/ForexGraphView';

type Hop = {
  from: string;
  to: string;
  rate: number;
  pairSymbol: string;
  inverted: boolean;
};

type GraphPath = {
  nodes: string[];
  hops: Hop[];
  product: number;
};

type Opportunity = {
  from: string;
  to: string;
  fromNameFa: string;
  toNameFa: string;
  spreadPct: number;
  meetsMinSpread: boolean;
  long: GraphPath;
  short: GraphPath;
  longActionsFa: string[];
  shortActionsFa: string[];
  summaryFa: string;
};

type ArbCycle = {
  nodes: string[];
  hops: Hop[];
  product: number;
  profitPct: number;
  actionsFa: string[];
  summaryFa: string;
};

type Analysis = {
  minSpreadPct: number;
  pathCountCompared: number;
  signalCount: number;
  opportunities: Opportunity[];
  nearMisses: Opportunity[];
  cycles: ArbCycle[];
  featured: Opportunity[];
  narrativeFa: string[];
};

type NodeDto = { code: string; nameFa: string; kind: 'FIAT' | 'CRYPTO' | 'METAL' | string };
type EdgeDto = Hop & { source: string; yahooSymbol: string | null };

type Snapshot = {
  id: string;
  capturedAt: string;
  source: string;
  nodeCount: number;
  edgeCount: number;
  pairCount: number;
  nodes: NodeDto[];
  edges: EdgeDto[];
  analysis: Analysis;
};

type SnapshotMeta = {
  id: string;
  capturedAt: string;
  source: string;
  nodeCount: number;
  edgeCount: number;
  pairCount: number;
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('fa-IR', {
    timeZone: 'Asia/Tehran',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function formatPct(n: number) {
  return `${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function formatRate(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 5 : 6;
  return n.toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

function OppCard({
  opp,
  active,
  onPick,
}: {
  opp: Opportunity;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={clsx(
        'w-full rounded-xl border p-4 text-start transition',
        active
          ? 'border-gold-400 bg-gold-400/10 shadow-soft'
          : 'border-navy-900/10 bg-white hover:border-navy-900/20',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-navy-900">
          {opp.from} → {opp.to}
          <span className="ms-2 text-xs font-normal text-navy-800/55">
            {opp.fromNameFa} به {opp.toNameFa}
          </span>
        </div>
        <span
          className={clsx(
            'rounded-full px-2.5 py-0.5 text-xs font-semibold',
            opp.meetsMinSpread ? 'bg-emerald-700 text-white' : 'bg-navy-900/8 text-navy-800',
          )}
        >
          اختلاف {formatPct(opp.spreadPct)}
        </span>
      </div>
      <p className="mt-2 text-xs leading-6 text-navy-800/70">{opp.summaryFa}</p>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
          <div className="font-medium">لانگ · مسیر بلند</div>
          <div className="mt-1 leading-6">{opp.longActionsFa.join(' ← ')}</div>
          <div className="mt-1 opacity-70">ضرب نرخ {formatRate(opp.long.product)}</div>
        </div>
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-900">
          <div className="font-medium">شورت · مسیر کوتاه</div>
          <div className="mt-1 leading-6">{opp.shortActionsFa.join(' ← ')}</div>
          <div className="mt-1 opacity-70">ضرب نرخ {formatRate(opp.short.product)}</div>
        </div>
      </div>
    </button>
  );
}

export default function ForexPage() {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorFa, setErrorFa] = useState('');
  const [picked, setPicked] = useState<Opportunity | ArbCycle | null>(null);

  const selectedOpp = picked && 'spreadPct' in picked ? picked : null;
  const selectedCycle = picked && 'profitPct' in picked ? picked : null;

  async function loadLatest() {
    const snap = await api<Snapshot>('/forex');
    setData(snap);
    const list = await api<SnapshotMeta[]>('/forex/snapshots').catch(() => []);
    setHistory(list);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setLoading(true);
    loadLatest()
      .catch((e) => setErrorFa((e as Error).message))
      .finally(() => setLoading(false));
  }, [router]);

  async function refresh() {
    setRefreshing(true);
    setErrorFa('');
    try {
      const snap = await api<Snapshot>('/forex/refresh', { method: 'POST' });
      setData(snap);
      setPicked(null);
      const list = await api<SnapshotMeta[]>('/forex/snapshots').catch(() => []);
      setHistory(list);
    } catch (e) {
      setErrorFa((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  async function loadHistory(id: string) {
    setErrorFa('');
    try {
      const snap = await api<Snapshot>(`/forex/snapshots/${id}`);
      setData(snap);
      setPicked(null);
    } catch (e) {
      setErrorFa((e as Error).message);
    }
  }

  const quotes = useMemo(
    () => (data?.edges ?? []).filter((e) => !e.inverted).sort((a, b) => a.pairSymbol.localeCompare(b.pairSymbol)),
    [data],
  );

  const longHops = selectedOpp?.long.hops ?? selectedCycle?.hops ?? [];
  const shortHops = selectedOpp?.short.hops ?? [];

  return (
    <div className="space-y-6">
      {(loading || refreshing) && (
        <WaitingOverlay
          title={refreshing ? 'در حال ساخت گراف نرخ' : 'در حال خواندن گراف'}
          description="نرخ جفت‌ارزها، بیت‌کوین، اتریوم، طلا و نقره گرفته می‌شود و یال‌های وزن‌دار ذخیره می‌گردد."
          steps={[
            'دریافت نرخ از یاهو و منابع کمکی...',
            'ساخت رأس‌ها و یال‌های جهت‌دار...',
            'جستجوی مسیر بلند و کوتاه...',
            'بررسی اختلاف حداقل ۳٪...',
          ]}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">آزمایش گراف فارکس</h1>
            <span className="rounded-full bg-gold-400/20 px-2.5 py-0.5 text-xs font-medium text-navy-800">
              تست جدا از سبدیار
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-navy-800/70">
            هر رأس یک ارز یا دارایی است. هر یال یک جفت‌نرخ: مثلاً یورو به دلار با وزن همان نرخ. مسیر بلند
            لانگ و مسیر کوتاه شورت می‌شود اگر اختلاف حداقل ۳٪ باشد. این صفحه توصیهٔ معاملاتی نیست.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {history.length > 1 && (
            <select
              className="input max-w-[16rem] text-xs"
              value={data?.id ?? ''}
              onChange={(e) => {
                loadHistory(e.target.value).catch(() => undefined);
              }}
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {formatWhen(h.capturedAt)}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn-primary" disabled={refreshing} onClick={() => refresh()}>
            به‌روزرسانی نرخ
          </button>
        </div>
      </div>

      {errorFa && <p className="text-sm text-red-700">{errorFa}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: 'زمان ثبت', v: formatWhen(data.capturedAt) },
              { k: 'رأس‌ها', v: data.nodeCount.toLocaleString('fa-IR') },
              { k: 'یال‌های جهت‌دار', v: data.edgeCount.toLocaleString('fa-IR') },
              {
                k: 'سیگنال ≥ ۳٪',
                v: data.analysis.signalCount.toLocaleString('fa-IR'),
              },
            ].map((s) => (
              <div key={s.k} className="card py-4">
                <div className="text-xs text-navy-800/55">{s.k}</div>
                <div className="mt-1 text-lg font-semibold text-navy-900">{s.v}</div>
              </div>
            ))}
          </div>

          <ForexGraphView
            nodes={data.nodes}
            edges={data.edges}
            longHops={longHops}
            shortHops={shortHops}
          />

          <section className="card space-y-3">
            <h2 className="text-lg font-semibold">تحلیل عمیق گراف</h2>
            {data.analysis.narrativeFa.map((line, i) => (
              <p key={i} className="text-sm leading-7 text-navy-800/80">
                {line}
              </p>
            ))}
            <p className="text-xs text-navy-800/50">
              منبع این اسنپ‌شات:
              <span className="ms-1 font-mono" dir="ltr">
                {data.source}
              </span>
            </p>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">فرصت لانگ / شورت (≥ ۳٪)</h2>
              {data.analysis.opportunities.length === 0 && (
                <p className="card text-sm text-navy-800/60">
                  در این عکس اختلاف ۳٪ بین مسیرها دیده نشد. موارد نزدیک را در ستون کناری ببینید.
                </p>
              )}
              {data.analysis.opportunities.map((o) => (
                <OppCard
                  key={`${o.from}-${o.to}`}
                  opp={o}
                  active={selectedOpp?.from === o.from && selectedOpp?.to === o.to}
                  onPick={() => setPicked(o)}
                />
              ))}
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">نزدیک به آستانه و حلقه‌ها</h2>
              {data.analysis.nearMisses.map((o) => (
                <OppCard
                  key={`nm-${o.from}-${o.to}`}
                  opp={o}
                  active={selectedOpp?.from === o.from && selectedOpp?.to === o.to}
                  onPick={() => setPicked(o)}
                />
              ))}
              {data.analysis.cycles.map((c) => (
                <button
                  key={c.nodes.join('>')}
                  type="button"
                  onClick={() => setPicked(c)}
                  className={clsx(
                    'w-full rounded-xl border p-4 text-start',
                    selectedCycle && selectedCycle.nodes.join('>') === c.nodes.join('>')
                      ? 'border-gold-400 bg-gold-400/10'
                      : 'border-navy-900/10 bg-white',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">حلقه آربیتراژ</span>
                    <span className="text-xs font-semibold text-emerald-800">{formatPct(c.profitPct)}</span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-navy-800/70">{c.summaryFa}</p>
                </button>
              ))}
              {!data.analysis.nearMisses.length && !data.analysis.cycles.length && (
                <p className="card text-sm text-navy-800/60">مورد نزدیک به آستانه یا حلقهٔ ۳٪ نیست.</p>
              )}
            </section>
          </div>

          <section className="card overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-navy-900 text-white">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">جفت</th>
                  <th className="px-4 py-3 text-start font-medium">نرخ</th>
                  <th className="px-4 py-3 text-start font-medium">منبع</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.pairSymbol} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                    <td className="px-4 py-2.5 font-medium" dir="ltr">
                      {q.pairSymbol}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{formatRate(q.rate)}</td>
                    <td className="px-4 py-2.5 text-navy-800/60" dir="ltr">
                      {q.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
