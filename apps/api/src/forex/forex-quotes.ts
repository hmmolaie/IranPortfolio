import { FOREX_PAIRS, pairSymbol, type PairDef } from './forex-universe';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'application/json,text/plain,*/*',
};

export type QuotedPair = {
  base: string;
  quote: string;
  pairSymbol: string;
  rate: number;
  yahooSymbol: string;
  source: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asFinite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function quoted(pair: PairDef, rate: number, source: string): QuotedPair {
  return {
    base: pair.base,
    quote: pair.quote,
    pairSymbol: pairSymbol(pair.base, pair.quote),
    rate,
    yahooSymbol: pair.yahoo,
    source,
  };
}

function parseYahooSpark(data: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const spark = asRecord(asRecord(data)?.spark);
  const result = spark?.result;
  if (!Array.isArray(result)) return out;
  for (const row of result) {
    const rec = asRecord(row);
    const symbol = String(rec?.symbol ?? '');
    const response = Array.isArray(rec?.response) ? rec?.response[0] : rec?.response;
    const meta = asRecord(asRecord(response)?.meta);
    const price =
      asFinite(meta?.regularMarketPrice) ??
      asFinite(meta?.previousClose) ??
      asFinite(asRecord(response)?.close);
    if (symbol && price) out.set(symbol, price);
  }
  return out;
}

function parseYahooChart(data: unknown): number | null {
  const chart = asRecord(asRecord(data)?.chart);
  const result = Array.isArray(chart?.result) ? asRecord(chart.result[0]) : null;
  const meta = asRecord(result?.meta);
  return asFinite(meta?.regularMarketPrice) ?? asFinite(meta?.previousClose);
}

async function fetchYahooQuoteV7(pairs: PairDef[]): Promise<QuotedPair[]> {
  const symbols = pairs.map((p) => p.yahoo).join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
  const data = asRecord(await fetchJson(url, 18_000));
  const result = asRecord(data?.quoteResponse)?.result;
  const prices = new Map<string, number>();
  if (Array.isArray(result)) {
    for (const row of result) {
      const rec = asRecord(row);
      const symbol = String(rec?.symbol ?? '');
      const price = asFinite(rec?.regularMarketPrice);
      if (symbol && price) prices.set(symbol, price);
    }
  }
  const out: QuotedPair[] = [];
  for (const pair of pairs) {
    const rate = prices.get(pair.yahoo);
    if (rate) out.push(quoted(pair, rate, 'yahoo-quote'));
  }
  return out;
}

async function fetchYahooBatch(pairs: PairDef[]): Promise<QuotedPair[]> {
  const symbols = pairs.map((p) => p.yahoo).join(',');
  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols)}&range=1d&interval=1m`;
  const prices = parseYahooSpark(await fetchJson(url, 18_000));
  const out: QuotedPair[] = [];
  for (const pair of pairs) {
    const rate = prices.get(pair.yahoo);
    if (rate) out.push(quoted(pair, rate, 'yahoo-spark'));
  }
  return out;
}

async function fetchYahooChart(pair: PairDef): Promise<QuotedPair | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pair.yahoo)}?interval=1m&range=1d`;
  const rate = parseYahooChart(await fetchJson(url));
  return rate ? quoted(pair, rate, 'yahoo-chart') : null;
}

const BITSTAMP: Array<{ pair: PairDef; path: string }> = [
  { pair: { base: 'BTC', quote: 'USD', yahoo: 'BTC-USD' }, path: 'btcusd' },
  { pair: { base: 'BTC', quote: 'EUR', yahoo: 'BTC-EUR' }, path: 'btceur' },
  { pair: { base: 'ETH', quote: 'USD', yahoo: 'ETH-USD' }, path: 'ethusd' },
  { pair: { base: 'ETH', quote: 'EUR', yahoo: 'ETH-EUR' }, path: 'etheur' },
  { pair: { base: 'ETH', quote: 'BTC', yahoo: 'ETH-BTC' }, path: 'ethbtc' },
];

async function fetchBitstamp(): Promise<QuotedPair[]> {
  const rows = await Promise.all(
    BITSTAMP.map(async (item) => {
      try {
        const data = asRecord(
          await fetchJson(`https://www.bitstamp.net/api/v2/ticker/${item.path}/`),
        );
        const rate = asFinite(data?.last) ?? asFinite(data?.bid);
        return rate ? quoted(item.pair, rate, `bitstamp:${item.path}`) : null;
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is QuotedPair => Boolean(row));
}

async function fetchMetal(code: 'XAU' | 'XAG'): Promise<QuotedPair | null> {
  try {
    const data = asRecord(await fetchJson(`https://api.gold-api.com/price/${code}`));
    const rate = asFinite(data?.price);
    if (!rate) return null;
    return quoted(
      { base: code, quote: 'USD', yahoo: `${code}USD=X` },
      rate,
      `gold-api:${code}`,
    );
  } catch {
    return null;
  }
}

function mergeQuotes(chunks: QuotedPair[][]): QuotedPair[] {
  const byPair = new Map<string, QuotedPair>();
  for (const list of chunks) {
    for (const q of list) {
      byPair.set(q.pairSymbol, q);
    }
  }
  return [...byPair.values()];
}

async function fillMissingFromYahoo(have: QuotedPair[]): Promise<QuotedPair[]> {
  const haveSet = new Set(have.map((q) => q.pairSymbol));
  const missing = FOREX_PAIRS.filter((p) => !haveSet.has(pairSymbol(p.base, p.quote)));
  const extras: QuotedPair[] = [];
  const concurrency = 5;
  for (let i = 0; i < missing.length; i += concurrency) {
    const batch = missing.slice(i, i + concurrency);
    const rows = await Promise.all(
      batch.map(async (pair) => {
        try {
          return await fetchYahooChart(pair);
        } catch {
          return null;
        }
      }),
    );
    for (const row of rows) {
      if (row) extras.push(row);
    }
  }
  return extras;
}

export async function fetchForexQuotes(): Promise<{ quotes: QuotedPair[]; sources: string[] }> {
  const chunks: QuotedPair[][] = [];

  try {
    chunks.push(await fetchYahooBatch(FOREX_PAIRS));
  } catch {
    /* بعداً تکی پر می‌شود */
  }
  try {
    chunks.push(await fetchYahooQuoteV7(FOREX_PAIRS));
  } catch {
    /* اختیاری */
  }

  const [stamp, gold, silver] = await Promise.all([
    fetchBitstamp(),
    fetchMetal('XAU'),
    fetchMetal('XAG'),
  ]);
  chunks.push(stamp);
  if (gold) chunks.push([gold]);
  if (silver) chunks.push([silver]);

  let quotes = mergeQuotes(chunks);
  if (quotes.length < FOREX_PAIRS.length) {
    const extras = await fillMissingFromYahoo(quotes);
    quotes = mergeQuotes([quotes, extras]);
  }

  const sources = [...new Set(quotes.map((q) => q.source))];
  return { quotes, sources };
}
