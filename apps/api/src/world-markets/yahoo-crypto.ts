const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CHUNK = 40;

type YahooAuth = { cookie: string; crumb: string };

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

/** نماد Yahoo برای مقایسه با بیت‌پین؛ IRT هم از BASE-USD تبدیل می‌شود */
export function yahooSymbolFor(baseCode: string, quoteCode: string): string | null {
  const b = baseCode.trim().toUpperCase();
  const q = quoteCode.trim().toUpperCase();
  if (!b || b.length > 12 || /[^A-Z0-9]/.test(b)) return null;
  if (q === 'IRT' || q === 'USDT' || q === 'USDC' || q === 'USD' || q === 'DAI') {
    if (b === 'USDT' || b === 'USDC' || b === 'DAI' || b === 'USD') return null;
    return `${b}-USD`;
  }
  if (q === 'EUR') return `${b}-EUR`;
  if (q === 'BTC') return `${b}-BTC`;
  if (q === 'ETH') return `${b}-ETH`;
  return null;
}

function isYahooHost(hostname: string): boolean {
  return /(^|\.)finance\.yahoo\.com$/i.test(hostname) || hostname === 'fc.yahoo.com';
}

function cookieHeader(res: Response): string {
  const listed = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const parts = listed.length
    ? listed
    : (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,]+=)/);
  return parts
    .map((p) => p.split(';')[0]?.trim() ?? '')
    .filter((p) => p.includes('='))
    .join('; ');
}

async function yahooAuth(origin: string): Promise<YahooAuth | null> {
  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });
    const cookie = cookieHeader(cookieRes);
    if (!cookie) return null;
    const crumbRes = await fetch(`${origin}/v1/test/getcrumb`, {
      headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' },
      signal: AbortSignal.timeout(12_000),
    });
    const crumb = (await crumbRes.text()).trim();
    if (!crumbRes.ok || !crumb || crumb.includes('<') || /\s/.test(crumb)) return null;
    return { cookie, crumb };
  } catch {
    return null;
  }
}

function headers(auth: YahooAuth | null): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json' };
  if (auth?.cookie) h.Cookie = auth.cookie;
  return h;
}

function symbolsUrl(base: string, symbols: string[], extra?: Record<string, string>): string {
  const u = new URL(base);
  u.searchParams.set('symbols', symbols.join(','));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  }
  return u.toString();
}

async function fetchQuoteChunk(
  quoteUrl: string,
  symbols: string[],
  auth: YahooAuth | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const extra = auth?.crumb ? { crumb: auth.crumb } : undefined;
  const res = await fetch(symbolsUrl(quoteUrl, symbols, extra), {
    headers: headers(auth),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = asRecord(await res.json());
  const result = asRecord(data?.quoteResponse)?.result;
  if (!Array.isArray(result)) return out;
  for (const row of result) {
    const rec = asRecord(row);
    const symbol = String(rec?.symbol ?? '');
    const price = asFinite(rec?.regularMarketPrice) ?? asFinite(rec?.regularMarketPreviousClose);
    if (symbol && price) out.set(symbol, price);
  }
  return out;
}

async function fetchSparkChunk(
  sparkUrl: string,
  symbols: string[],
  auth: YahooAuth | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const extra: Record<string, string> = { range: '1d', interval: '1m' };
  if (auth?.crumb) extra.crumb = auth.crumb;
  const res = await fetch(symbolsUrl(sparkUrl, symbols, extra), {
    headers: headers(auth),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const spark = asRecord(asRecord(await res.json())?.spark);
  const result = spark?.result;
  if (!Array.isArray(result)) return out;
  for (const row of result) {
    const rec = asRecord(row);
    const symbol = String(rec?.symbol ?? '');
    const response = Array.isArray(rec?.response) ? rec.response[0] : rec?.response;
    const meta = asRecord(asRecord(response)?.meta);
    const price = asFinite(meta?.regularMarketPrice) ?? asFinite(meta?.previousClose);
    if (symbol && price) out.set(symbol, price);
  }
  return out;
}

async function fetchChartPrice(
  chartBase: string,
  symbol: string,
  auth: YahooAuth | null,
): Promise<number | null> {
  const u = new URL(`${chartBase.replace(/\/$/, '')}/${encodeURIComponent(symbol)}`);
  u.searchParams.set('interval', '1d');
  u.searchParams.set('range', '5d');
  if (auth?.crumb) u.searchParams.set('crumb', auth.crumb);
  const res = await fetch(u, {
    headers: headers(auth),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chart = asRecord(asRecord(await res.json())?.chart);
  const result = Array.isArray(chart?.result) ? asRecord(chart.result[0]) : null;
  const meta = asRecord(result?.meta);
  return asFinite(meta?.regularMarketPrice) ?? asFinite(meta?.previousClose);
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item) => fn(item)));
  }
}

function tehranDay(sec: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date(sec * 1000));
}

async function fetchChartSeries(
  chartBase: string,
  symbol: string,
  auth: YahooAuth | null,
  range: string,
): Promise<Array<{ tradeDate: string; close: number }>> {
  const u = new URL(`${chartBase.replace(/\/$/, '')}/${encodeURIComponent(symbol)}`);
  u.searchParams.set('interval', '1d');
  u.searchParams.set('range', range);
  if (auth?.crumb) u.searchParams.set('crumb', auth.crumb);
  const res = await fetch(u, {
    headers: headers(auth),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const chart = asRecord(asRecord(await res.json())?.chart);
  const result = Array.isArray(chart?.result) ? asRecord(chart.result[0]) : null;
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = asRecord(result?.indicators);
  const series = Array.isArray(quote?.quote) ? asRecord(quote.quote[0]) : null;
  const closes = Array.isArray(series?.close) ? series.close : [];
  const byDay = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i += 1) {
    const sec = Number(timestamps[i]);
    const close = asFinite(closes[i]);
    if (!Number.isFinite(sec) || close == null) continue;
    byDay.set(tehranDay(sec), close);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tradeDate, close]) => ({ tradeDate, close }));
}

/** کندل روزانهٔ یاهو برای نمودار؛ اول بیشترین بازه، بعد پنج‌سال */
export async function fetchYahooDailyHistory(
  symbol: string,
  quoteUrl: string,
): Promise<Array<{ tradeDate: string; close: number }>> {
  const quote = new URL(quoteUrl);
  const auth = isYahooHost(quote.hostname) ? await yahooAuth(quote.origin) : null;
  const chartBase = `${quote.origin}/v8/finance/chart`;
  for (const range of ['max', '5y']) {
    try {
      const bars = await fetchChartSeries(chartBase, symbol, auth, range);
      if (bars.length >= 2) return bars;
    } catch {
      /* بازهٔ بعدی */
    }
  }
  return [];
}

export async function fetchYahooCryptoPrices(
  symbols: string[],
  quoteUrl: string,
): Promise<Map<string, number>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const out = new Map<string, number>();
  const quote = new URL(quoteUrl);
  const origin = quote.origin;
  const yahoo = isYahooHost(quote.hostname);
  const sparkUrl = `${origin}/v8/finance/spark`;
  const chartBase = `${origin}/v8/finance/chart`;
  const auth = yahoo ? await yahooAuth(origin) : null;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      for (const [k, v] of await fetchQuoteChunk(quoteUrl, chunk, auth)) out.set(k, v);
    } catch {
      /* دستهٔ بعد یا مسیر جایگزین */
    }
  }

  if (yahoo) {
    const missingSpark = unique.filter((s) => !out.has(s));
    for (let i = 0; i < missingSpark.length; i += CHUNK) {
      const chunk = missingSpark.slice(i, i + CHUNK);
      try {
        for (const [k, v] of await fetchSparkChunk(sparkUrl, chunk, auth)) out.set(k, v);
      } catch {
        /* نمودار تکی */
      }
    }
  }

  const missing = unique.filter((s) => !out.has(s));
  if (yahoo && missing.length) {
    try {
      const probe = await fetchChartPrice(chartBase, missing[0], auth);
      if (probe) {
        out.set(missing[0], probe);
        await mapPool(missing.slice(1), 6, async (symbol) => {
          try {
            const price = await fetchChartPrice(chartBase, symbol, auth);
            if (price) out.set(symbol, price);
          } catch {
            /* این نماد رد می‌شود */
          }
        });
      }
    } catch {
      /* نمودار یاهو در دسترس نیست */
    }
  }

  return out;
}
