import { currencyMeta, type AssetKind } from './forex-universe';
import type { QuotedPair } from './forex-quotes';

export const MIN_SPREAD = 0.03;
const MAX_DEPTH = 4;
const MAX_PATHS_PER_TARGET = 48;

export type GraphHop = {
  from: string;
  to: string;
  rate: number;
  pairSymbol: string;
  inverted: boolean;
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
};

export type SpreadOpportunity = {
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

export type ArbCycle = {
  nodes: string[];
  hops: GraphHop[];
  product: number;
  profitPct: number;
  actionsFa: string[];
  summaryFa: string;
};

export type ForexAnalysis = {
  minSpreadPct: number;
  pathCountCompared: number;
  signalCount: number;
  opportunities: SpreadOpportunity[];
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
  return `${n.toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;
}

function formatRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 5 : 6;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function hopAction(hop: GraphHop, side: 'long' | 'short'): string {
  const verb = side === 'long' ? 'خرید' : 'فروش';
  return `${verb} ${hop.pairSymbol}`;
}

function pathLabel(path: GraphPath): string {
  return path.nodes.join(' → ');
}

function toOpportunity(
  from: string,
  to: string,
  long: GraphPath,
  short: GraphPath,
  spread: number,
): SpreadOpportunity {
  const spreadPct = spread * 100;
  const fromNameFa = currencyMeta(from).nameFa;
  const toNameFa = currencyMeta(to).nameFa;
  return {
    from,
    to,
    fromNameFa,
    toNameFa,
    spreadPct,
    meetsMinSpread: spread >= MIN_SPREAD,
    long,
    short,
    longActionsFa: long.hops.map((h) => hopAction(h, 'long')),
    shortActionsFa: short.hops.map((h) => hopAction(h, 'short')),
    summaryFa: `تبدیل ${from} به ${to}: مسیر بلند ${pathLabel(long)} معادل ${formatRate(long.product)} و مسیر کوتاه ${pathLabel(short)} معادل ${formatRate(short.product)} است؛ اختلاف ${formatPct(spreadPct)}.`,
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
          const profitPct = (product - 1) * 100;
          if (product >= 1 + MIN_SPREAD) {
            const ring = [...nodes, start];
            const key = cycleKey(ring);
            if (!seen.has(key)) {
              seen.add(key);
              cycles.push({
                nodes: ring,
                hops: allHops,
                product,
                profitPct,
                actionsFa: allHops.map((h) => hopAction(h, 'long')),
                summaryFa: `حلقه ${ring.join(' → ')} با ضرب نرخ ${formatRate(product)} حدود ${formatPct(profitPct)} سود اسمی می‌دهد.`,
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

  cycles.sort((a, b) => b.profitPct - a.profitPct);
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
  lines.push(
    `گراف با ${nodeCount.toLocaleString('fa-IR')} رأس (ارز/دارایی) و ${pairCount.toLocaleString('fa-IR')} جفت‌نرخ ساخته شد. هر یال جهت‌دار یک تبدیل است: وزن یال همان نرخ است.`,
  );
  lines.push(
    `ایدهٔ معامله: بین دو ارز، مسیر با بیشترین حاصل‌ضرب نرخ را لانگ و مسیر با کمترین حاصل‌ضرب را شورت می‌کنیم. آستانهٔ سیگنال ${formatPct(MIN_SPREAD * 100)} است.`,
  );

  if (analysis.signalCount === 0) {
    lines.push(
      `در این عکس‌برداری هیچ دو مسیری با اختلاف حداقل ${formatPct(MIN_SPREAD * 100)} پیدا نشد. در بازار نقدشونده معمولاً آربیتراژ چندمسیره سریع از بین می‌رود یا زیر هزینهٔ کارمزد و اسپرد می‌ماند.`,
    );
    if (analysis.nearMisses[0]) {
      const n = analysis.nearMisses[0];
      lines.push(
        `بزرگ‌ترین اختلاف مشاهده‌شده حدود ${formatPct(n.spreadPct)} بین ${n.from} و ${n.to} بود؛ زیر آستانه است و سیگنال محسوب نمی‌شود.`,
      );
    }
  } else {
    const top = analysis.opportunities[0];
    lines.push(
      `${analysis.signalCount.toLocaleString('fa-IR')} فرصت با اختلاف حداقل ${formatPct(MIN_SPREAD * 100)} دیده شد. قوی‌ترین: ${top.from} → ${top.to} با ${formatPct(top.spreadPct)}.`,
    );
    lines.push(
      `نمونه اجرا (آزمایشی): ${top.longActionsFa.join('، ')} را لانگ و ${top.shortActionsFa.join('، ')} را شورت. این متن توصیهٔ معامله نیست؛ تأخیر قیمت و کارمزد می‌تواند اختلاف را صفر کند.`,
    );
  }

  if (analysis.cycles.length) {
    lines.push(
      `${analysis.cycles.length.toLocaleString('fa-IR')} حلقه با سود اسمی حداقل ${formatPct(MIN_SPREAD * 100)} هم دیده شد (ضرب نرخ دور کامل > ۱). حلقه‌ها به کارمزد و لغزش بسیار حساس‌اند.`,
    );
  } else {
    lines.push('حلقهٔ آربیتراژ با سود اسمی ۳٪ یا بیشتر در این گراف دیده نشد.');
  }

  lines.push(
    'مسیرهایی که فیات را به بیت‌کوین/طلا وصل می‌کنند از چند منبع قیمت می‌آیند؛ اختلاف می‌تواند اختلاف منبع باشد نه فرصت واقعی قابل‌اجرا.',
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
    edges.push({
      from: q.base,
      to: q.quote,
      rate: q.rate,
      pairSymbol: q.pairSymbol,
      inverted: false,
      source: q.source,
      yahooSymbol: q.yahooSymbol,
    });
    edges.push({
      from: q.quote,
      to: q.base,
      rate: 1 / q.rate,
      pairSymbol: q.pairSymbol,
      inverted: true,
      source: q.source,
      yahooSymbol: q.yahooSymbol,
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
      const spread = long.product / short.product - 1;
      if (!(spread > 0) || !Number.isFinite(spread)) continue;
      if (long.nodes.join('>') === short.nodes.join('>')) continue;
      const key = uniquePairKey(src, dst);
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      allOpps.push(toOpportunity(src, dst, long, short, spread));
    }
  }

  allOpps.sort((a, b) => b.spreadPct - a.spreadPct);
  const opportunities = allOpps.filter((o) => o.meetsMinSpread).slice(0, 20);
  const nearMisses = allOpps.filter((o) => !o.meetsMinSpread).slice(0, 8);
  const cycles = findCycles(adj);
  const featured = pickFeatured(allOpps);

  const analysisBody: Omit<ForexAnalysis, 'narrativeFa'> = {
    minSpreadPct: MIN_SPREAD * 100,
    pathCountCompared,
    signalCount: opportunities.length,
    opportunities,
    nearMisses,
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
