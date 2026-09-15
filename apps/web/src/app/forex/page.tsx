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
  spread?: number | null;
};

type GraphPath = {
  nodes: string[];
  hops: Hop[];
  product: number;
};

type LegCost = {
  pairSymbol: string;
  side: 'long' | 'short';
  spreadPct: number;
  spreadSource: 'market' | 'default';
  commissionPct: number;
  slippagePct: number;
  swapPct: number;
  subtotalPct: number;
};

type TradePnl = {
  grossPct: number;
  spreadPct: number;
  commissionPct: number;
  slippagePct: number;
  swapPct: number;
  syncLagPct: number;
  costPct: number;
  netPct: number;
  grossUsd: number;
  costUsd: number;
  netUsd: number;
  recommend: boolean;
  legCount: number;
  legs: LegCost[];
};

type Opportunity = {
  from: string;
  to: string;
  fromNameFa: string;
  toNameFa: string;
  spreadPct: number;
  recommend: boolean;
  pnl: TradePnl;
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
  recommend: boolean;
  pnl: TradePnl;
  actionsFa: string[];
  summaryFa: string;
};

type CostModel = {
  notionalUsd: number;
  commissionPctPerSide: number;
  syncLagPct: number;
  noteFa: string;
  bucketsFa: Array<{ labelFa: string; spreadPct: number; slippagePct: number; swapPct: number }>;
};

type Analysis = {
  pathCountCompared: number;
  signalCount: number;
  averageNetPct: number;
  costModel: CostModel;
  opportunities: Opportunity[];
  watchlist: Opportunity[];
  nearMisses: Opportunity[];
  cycles: ArbCycle[];
  featured: Opportunity[];
  narrativeFa: string[];
};

type NodeDto = { code: string; nameFa: string; kind: 'FIAT' | 'CRYPTO' | 'METAL' | string };
type EdgeDto = Hop & { source: string; yahooSymbol: string | null; bid?: number | null; ask?: number | null };

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
  const digits = Math.abs(n) < 1 ? 3 : 2;
  return `${n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}٪`;
}

function formatUsd(n: number) {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('fa-IR', { maximumFractionDigits: 0 })} دلار`;
}

function formatRate(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 5 : 6;
  return n.toLocaleString('fa-IR', { maximumFractionDigits: digits });
}

function PnlBox({ pnl }: { pnl: TradePnl }) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div>ناخالص: {formatPct(pnl.grossPct)}</div>
        <div>اسپرد: {formatPct(pnl.spreadPct)}</div>
        <div>کمیسیون: {formatPct(pnl.commissionPct)}</div>
        <div>لغزش: {formatPct(pnl.slippagePct)}</div>
        <div>سواپ: {formatPct(pnl.swapPct)}</div>
        <div>تأخیر همزمان: {formatPct(pnl.syncLagPct)}</div>
        <div>جمع هزینه: {formatPct(pnl.costPct)}</div>
        <div className={pnl.netPct > 0 ? 'font-semibold text-emerald-800' : 'font-semibold text-rose-800'}>
          خالص: {formatPct(pnl.netPct)} ≈ {formatUsd(pnl.netUsd)}
        </div>
      </div>
      <div className="text-[11px] leading-6 text-navy-800/55">
        ناخالص {formatUsd(pnl.grossUsd)} − هزینه {formatUsd(pnl.costUsd)} روی حجم ۱۰۰٬۰۰۰ دلار · {pnl.legCount.toLocaleString('fa-IR')} پا
      </div>
    </div>
  );
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
  const pnl = opp.pnl;
  return (
    <button
      type="button"
      onClick={onPick}
      className={clsx(
        'w-full rounded-xl border p-4 text-start transition',
        active
          ? 'border-gold-400 bg-gold-400/10 shadow-soft'
          : opp.recommend
            ? 'border-emerald-700/30 bg-white hover:border-emerald-700/50'
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
            opp.recommend ? 'bg-emerald-700 text-white' : 'bg-navy-900/8 text-navy-800',
          )}
        >
          {opp.recommend ? 'پیشنهاد معامله' : 'فقط نمایش'}
        </span>
      </div>
      <p className="mt-2 text-xs leading-6 text-navy-800/70">{opp.summaryFa}</p>
      {pnl && <PnlBox pnl={pnl} />}
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
            'کسر اسپرد، کمیسیون، لغزش و سواپ...',
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
            هر رأس یک ارز است. مسیر بلند لانگ و مسیر کوتاه شورت می‌شود. پیشنهاد معامله فقط وقتی سود خالص پس از اسپرد، کمیسیون، لغزش، سواپ و تأخیر اجرا مثبت باشد. این صفحه توصیهٔ رسمی نیست.
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
                k: 'پیشنهاد سود خالص',
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
            {data.analysis.costModel && (
              <div className="rounded-xl bg-navy-50/70 p-4 text-xs leading-6 text-navy-800/75">
                <p>{data.analysis.costModel.noteFa}</p>
                <p className="mt-2">
                  کمیسیون هر پا {formatPct(data.analysis.costModel.commissionPctPerSide)} · تأخیر همزمان پایه{' '}
                  {formatPct(data.analysis.costModel.syncLagPct)} · حجم{' '}
                  {data.analysis.costModel.notionalUsd.toLocaleString('fa-IR')} دلار
                </p>
                {data.analysis.averageNetPct != null && (
                  <p className="mt-1">
                    میانگین سود خالص همهٔ موقعیت‌های دیده‌شده: {formatPct(data.analysis.averageNetPct)}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-navy-800/50">
              منبع این اسنپ‌شات:
              <span className="ms-1 font-mono" dir="ltr">
                {data.source}
              </span>
            </p>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">پیشنهاد معامله (سود خالص مثبت)</h2>
              {data.analysis.opportunities.length === 0 && (
                <p className="card text-sm text-navy-800/60">
                  پس از کسر هزینه هیچ فرصتی سود خالص مثبت ندارد. بهترین موقعیت‌ها فقط نمایش داده می‌شوند.
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
              <h2 className="text-lg font-semibold">بهترین موقعیت‌ها بدون پیشنهاد</h2>
              {(data.analysis.watchlist ?? data.analysis.nearMisses ?? []).map((o) => (
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
                    <span
                      className={clsx(
                        'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                        c.recommend ? 'bg-emerald-700 text-white' : 'bg-navy-900/8 text-navy-800',
                      )}
                    >
                      {c.recommend ? 'پیشنهاد معامله' : 'فقط نمایش'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-navy-800/70">{c.summaryFa}</p>
                  {c.pnl && <PnlBox pnl={c.pnl} />}
                </button>
              ))}
              {!(data.analysis.watchlist ?? data.analysis.nearMisses ?? []).length &&
                !data.analysis.cycles.length && (
                  <p className="card text-sm text-navy-800/60">موقعیت نزدیکی برای نمایش نیست.</p>
                )}
            </section>
          </div>

          <section className="card overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="bg-navy-900 text-white">
                <tr>
                  <th className="px-4 py-3 text-start font-medium">جفت</th>
                  <th className="px-4 py-3 text-start font-medium">نرخ</th>
                  <th className="px-4 py-3 text-start font-medium">اسپرد</th>
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
                    <td className="px-4 py-2.5 tabular-nums">
                      {q.spread != null ? formatPct(q.spread * 100) : 'پیش‌فرض'}
                    </td>
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
