import { currencyMeta, type AssetKind } from './forex-universe';
import type { QuotedPair } from './forex-quotes';
import {
  costModelPublic,
  settleTrade,
  type CostModelPublic,
  type TradePnl,
} from './forex-costs';

const MAX_DEPTH = 4;
const MAX_PATHS_PER_TARGET = 48;

export type GraphHop = {
  from: string;
  to: string;
  rate: number;
  pairSymbol: string;
  inverted: boolean;
  /** کسر اسپرد بازار (ask-bid)/mid ؛ اگر نباشد هزینهٔ پیش‌فرض */
  spread: number | null;
};

export type GraphPath = {
  nodes: string[];
  hops: GraphHop[];
  product: number;
};

export type GraphNodeDto = {
  code: string;
  nameFa: string;
  kind: AssetKind;
};

export type GraphEdgeDto = GraphHop & {
  source: string;
  yahooSymbol: string | null;
  bid: number | null;
  ask: number | null;
};

export type SpreadOpportunity = {
  from: string;
  to: string;
  fromNameFa: string;
  toNameFa: string;
  /** اختلاف ناخالص مسیرها به درصد */
  spreadPct: number;
  recommend: boolean;
  pnl: TradePnl;
  long: GraphPath;
  short: GraphPath;
  longActionsFa: string[];
  shortActionsFa: string[];
  summaryFa: string;
};

export type ArbCycle = {
  nodes: string[];
  hops: GraphHop[];
  product: number;
  profitPct: number;
  recommend: boolean;
  pnl: TradePnl;
  actionsFa: string[];
  summaryFa: string;
};

export type ForexAnalysis = {
  pathCountCompared: number;
  signalCount: number;
  averageNetPct: number;
  costModel: CostModelPublic;
  opportunities: SpreadOpportunity[];
  watchlist: SpreadOpportunity[];
  /** سازگاری با اسنپ‌شات‌های قبلی */
  nearMisses: SpreadOpportunity[];
  cycles: ArbCycle[];
  featured: SpreadOpportunity[];
  narrativeFa: string[];
};

export type BuiltGraph = {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  pairCount: number;
  analysis: ForexAnalysis;
};

function pathProduct(hops: GraphHop[]): number {
  let log = 0;
  for (const h of hops) {
    if (!(h.rate > 0)) return 0;
    log += Math.log(h.rate);
  }
  return Math.exp(log);
}

function formatPct(n: number): string {
  const digits = Math.abs(n) < 1 ? 3 : 2;
  return `${n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}٪`;
}

function formatRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 5 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function formatUsd(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toLocaleString('fa-IR', { maximumFractionDigits: 0 })} دلار`;
}

function hopAction(hop: GraphHop, side: 'long' | 'short'): string {
  const verb = side === 'long' ? 'خرید' : 'فروش';
  return `${verb} ${hop.pairSymbol}`;
}

function pathLabel(path: GraphPath): string {
  return path.nodes.join(' → ');
}

function pnlForHops(
  grossFraction: number,
  hops: Array<{ hop: GraphHop; side: 'long' | 'short' }>,
): TradePnl {
  return settleTrade(
    grossFraction,
    hops.map(({ hop, side }) => ({
      pairSymbol: hop.pairSymbol,
      side,
      marketSpread: hop.spread,
    })),
  );
}

function toOpportunity(
  from: string,
  to: string,
  long: GraphPath,
  short: GraphPath,
  grossFraction: number,
): SpreadOpportunity {
  const pnl = pnlForHops(grossFraction, [
    ...long.hops.map((hop) => ({ hop, side: 'long' as const })),
    ...short.hops.map((hop) => ({ hop, side: 'short' as const })),
  ]);
  const fromNameFa = currencyMeta(from).nameFa;
  const toNameFa = currencyMeta(to).nameFa;
  const verdict = pnl.recommend
    ? `سود خالص ${formatPct(pnl.netPct)} ≈ ${formatUsd(pnl.netUsd)} روی ۱۰۰٬۰۰۰ دلار — پیشنهاد معامله.`
    : `سود ناخالص ${formatPct(pnl.grossPct)} پس از هزینه ${formatPct(pnl.costPct)} می‌شود ${formatPct(pnl.netPct)} — پیشنهاد خرید/فروش نمی‌شود.`;
  return {
    from,
    to,
    fromNameFa,
    toNameFa,
    spreadPct: pnl.grossPct,
    recommend: pnl.recommend,
    pnl,
    long,
    short,
    longActionsFa: long.hops.map((h) => hopAction(h, 'long')),
    shortActionsFa: short.hops.map((h) => hopAction(h, 'short')),
    summaryFa: `تبدیل ${from} به ${to}: مسیر بلند ${pathLabel(long)} در برابر مسیر کوتاه ${pathLabel(short)}. ${verdict}`,
  };
}

function enumeratePaths(adj: Map<string, GraphHop[]>, src: string): Map<string, GraphPath[]> {
  const found = new Map<string, GraphPath[]>();

  const walk = (
    node: string,
    hops: GraphHop[],
    nodes: string[],
    visited: Set<string>,
  ) => {
    if (nodes.length >= 2) {
      const list = found.get(node) ?? [];
      if (list.length < MAX_PATHS_PER_TARGET) {
        list.push({ nodes: [...nodes], hops: [...hops], product: pathProduct(hops) });
        found.set(node, list);
      }
    }
    if (hops.length >= MAX_DEPTH) return;
    for (const edge of adj.get(node) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      hops.push(edge);
      nodes.push(edge.to);
      walk(edge.to, hops, nodes, visited);
      nodes.pop();
      hops.pop();
      visited.delete(edge.to);
    }
  };

  walk(src, [], [src], new Set([src]));
  return found;
}

function uniquePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function cycleKey(nodes: string[]): string {
  const body = nodes.slice(0, -1);
  if (!body.length) return nodes.join('>');
  let minI = 0;
  for (let i = 1; i < body.length; i++) {
    if (body[i] < body[minI]) minI = i;
  }
  const rot = [...body.slice(minI), ...body.slice(0, minI)];
  return `${rot.join('>')}>${rot[0]}`;
}

function findCycles(adj: Map<string, GraphHop[]>): ArbCycle[] {
  const cycles: ArbCycle[] = [];
  const seen = new Set<string>();
  const startNodes = [...adj.keys()].sort();

  for (const start of startNodes) {
    const walk = (node: string, hops: GraphHop[], nodes: string[], visited: Set<string>) => {
      if (hops.length >= MAX_DEPTH) return;
      for (const edge of adj.get(node) ?? []) {
        if (edge.to === start && hops.length >= 2) {
          const allHops = [...hops, edge];
          const product = pathProduct(allHops);
          const gross = product - 1;
          if (product > 1 && Number.isFinite(gross)) {
            const ring = [...nodes, start];
            const key = cycleKey(ring);
            if (!seen.has(key)) {
              seen.add(key);
              const pnl = pnlForHops(
                gross,
                allHops.map((hop) => ({ hop, side: 'long' as const })),
              );
              cycles.push({
                nodes: ring,
                hops: allHops,
                product,
                profitPct: pnl.grossPct,
                recommend: pnl.recommend,
                pnl,
                actionsFa: allHops.map((h) => hopAction(h, 'long')),
                summaryFa: pnl.recommend
                  ? `حلقه ${ring.join(' → ')} پس از هزینه سود خالص ${formatPct(pnl.netPct)} ≈ ${formatUsd(pnl.netUsd)} دارد.`
                  : `حلقه ${ring.join(' → ')} ناخالص ${formatPct(pnl.grossPct)} است؛ پس از هزینه ${formatPct(pnl.netPct)} می‌ماند و پیشنهاد نمی‌شود.`,
              });
            }
          }
          continue;
        }
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        hops.push(edge);
        nodes.push(edge.to);
        walk(edge.to, hops, nodes, visited);
        nodes.pop();
        hops.pop();
        visited.delete(edge.to);
      }
    };
    walk(start, [], [start], new Set([start]));
  }

  cycles.sort((a, b) => b.pnl.netPct - a.pnl.netPct || b.profitPct - a.profitPct);
  return cycles.slice(0, 12);
}

function pickFeatured(opps: SpreadOpportunity[]): SpreadOpportunity[] {
  const want = [
    ['EUR', 'USD'],
    ['GBP', 'USD'],
    ['BTC', 'USD'],
    ['XAU', 'USD'],
    ['ETH', 'BTC'],
  ];
  const out: SpreadOpportunity[] = [];
  for (const [from, to] of want) {
    const hit = opps.find(
      (o) => (o.from === from && o.to === to) || (o.from === to && o.to === from),
    );
    if (hit) out.push(hit);
  }
  return out.slice(0, 5);
}

function buildNarrative(
  pairCount: number,
  nodeCount: number,
  analysis: Omit<ForexAnalysis, 'narrativeFa'>,
): string[] {
  const lines: string[] = [];
  const n = analysis.costModel.notionalUsd.toLocaleString('fa-IR');
  lines.push(
    `گراف با ${nodeCount.toLocaleString('fa-IR')} رأس و ${pairCount.toLocaleString('fa-IR')} جفت‌نرخ. سود ناخالص = اختلاف حاصل‌ضرب مسیر بلند و کوتاه (نرخ میانی).`,
  );
  lines.push(
    `برای هر سیگنال: سود خالص = ناخالص − اسپرد همهٔ پاها − کمیسیون − لغزش − سواپ یک‌شب − تأخیر اجرای همزمان. حجم فرضی ${n} دلار.`,
  );
  lines.push(
    `میانگین سود خالص همهٔ موقعیت‌های رتبه‌بندی‌شده ${formatPct(analysis.averageNetPct)} است. پیشنهاد معامله فقط اگر سود خالص همان فرصت > ۰ باشد.`,
  );

  if (analysis.signalCount === 0) {
    lines.push(
      'در این عکس هیچ مسیری پس از هزینه سود خالص مثبت ندارد. بهترین موقعیت‌ها فقط برای مشاهده رتبه‌بندی شده‌اند؛ ورود پیشنهاد نمی‌شود.',
    );
    if (analysis.watchlist[0]) {
      const top = analysis.watchlist[0];
      lines.push(
        `نزدیک‌ترین مورد ${top.from} → ${top.to}: ناخالص ${formatPct(top.pnl.grossPct)}، هزینه ${formatPct(top.pnl.costPct)}، خالص ${formatPct(top.pnl.netPct)} ≈ ${formatUsd(top.pnl.netUsd)}.`,
      );
    }
  } else {
    const top = analysis.opportunities[0];
    lines.push(
      `${analysis.signalCount.toLocaleString('fa-IR')} فرصت با سود خالص مثبت. قوی‌ترین: ${top.from} → ${top.to} خالص ${formatPct(top.pnl.netPct)} ≈ ${formatUsd(top.pnl.netUsd)}.`,
    );
    lines.push(
      `اجرا (آزمایشی): ${top.longActionsFa.join('، ')} لانگ و ${top.shortActionsFa.join('، ')} شورت. تأخیر واقعی سفارش می‌تواند همین حاشیه را هم از بین ببرد.`,
    );
  }

  const recCycles = analysis.cycles.filter((c) => c.recommend).length;
  if (recCycles) {
    lines.push(`${recCycles.toLocaleString('fa-IR')} حلقه پس از هزینه هنوز سود خالص مثبت دارد.`);
  } else {
    lines.push('هیچ حلقهٔ آربیتراژ پس از هزینه سود خالص مثبت ندارد.');
  }

  lines.push(
    'اسپرد اگر بید/آسک از بازار بیاید همان استفاده می‌شود؛ وگرنه پیش‌فرض نقدشوندگی جفت اصلی/کراس/اگزاتیک/رمزارز/فلز. مسیر فیات–رمزارز ممکن است اختلاف منبع باشد نه فرصت قابل‌اجرا.',
  );
  return lines;
}

export function buildWeightedGraph(quotes: QuotedPair[]): BuiltGraph {
  const nodeCodes = new Set<string>();
  const edges: GraphEdgeDto[] = [];

  for (const q of quotes) {
    if (!(q.rate > 0)) continue;
    nodeCodes.add(q.base);
    nodeCodes.add(q.quote);
    const spread = q.spread ?? null;
    const bid = q.bid;
    const ask = q.ask;
    edges.push({
      from: q.base,
      to: q.quote,
      rate: q.rate,
      pairSymbol: q.pairSymbol,
      inverted: false,
      spread,
      source: q.source,
      yahooSymbol: q.yahooSymbol,
      bid,
      ask,
    });
    const invBid = ask && ask > 0 ? 1 / ask : null;
    const invAsk = bid && bid > 0 ? 1 / bid : null;
    edges.push({
      from: q.quote,
      to: q.base,
      rate: 1 / q.rate,
      pairSymbol: q.pairSymbol,
      inverted: true,
      spread,
      source: q.source,
      yahooSymbol: q.yahooSymbol,
      bid: invBid,
      ask: invAsk,
    });
  }

  const nodes: GraphNodeDto[] = [...nodeCodes]
    .sort()
    .map((code) => {
      const meta = currencyMeta(code);
      return { code, nameFa: meta.nameFa, kind: meta.kind };
    });

  const adj = new Map<string, GraphHop[]>();
  for (const e of edges) {
    const hop: GraphHop = {
      from: e.from,
      to: e.to,
      rate: e.rate,
      pairSymbol: e.pairSymbol,
      inverted: e.inverted,
      spread: e.spread,
    };
    const list = adj.get(e.from) ?? [];
    list.push(hop);
    adj.set(e.from, list);
  }

  const allOpps: SpreadOpportunity[] = [];
  let pathCountCompared = 0;
  const seenPair = new Set<string>();

  for (const src of nodeCodes) {
    const byTarget = enumeratePaths(adj, src);
    for (const [dst, paths] of byTarget) {
      if (paths.length < 2) continue;
      const valid = paths.filter((p) => p.product > 0 && Number.isFinite(p.product));
      if (valid.length < 2) continue;
      pathCountCompared += valid.length;
      let long = valid[0];
      let short = valid[0];
      for (const p of valid) {
        if (p.product > long.product) long = p;
        if (p.product < short.product) short = p;
      }
      if (short.product <= 0) continue;
      const gross = long.product / short.product - 1;
      if (!(gross > 0) || !Number.isFinite(gross)) continue;
      if (long.nodes.join('>') === short.nodes.join('>')) continue;
      const key = uniquePairKey(src, dst);
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      allOpps.push(toOpportunity(src, dst, long, short, gross));
    }
  }

  allOpps.sort((a, b) => b.pnl.netPct - a.pnl.netPct || b.spreadPct - a.spreadPct);
  const opportunities = allOpps.filter((o) => o.recommend).slice(0, 20);
  const watchlist = allOpps.filter((o) => !o.recommend).slice(0, 12);
  const cycles = findCycles(adj);
  const featured = pickFeatured(allOpps);
  const averageNetPct =
    allOpps.length > 0 ? allOpps.reduce((s, o) => s + o.pnl.netPct, 0) / allOpps.length : 0;

  const analysisBody: Omit<ForexAnalysis, 'narrativeFa'> = {
    pathCountCompared,
    signalCount: opportunities.length,
    averageNetPct,
    costModel: costModelPublic(),
    opportunities,
    watchlist,
    nearMisses: watchlist,
    cycles,
    featured,
  };

  const analysis: ForexAnalysis = {
    ...analysisBody,
    narrativeFa: buildNarrative(quotes.length, nodes.length, analysisBody),
  };

  return {
    nodes,
    edges,
    pairCount: quotes.length,
    analysis,
  };
}
