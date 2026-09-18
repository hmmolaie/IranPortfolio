const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CHUNK = 40;

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

async function fetchQuoteChunk(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
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

async function fetchSparkChunk(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!symbols.length) return out;
  const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=1m`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
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

export async function fetchYahooCryptoPrices(symbols: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const out = new Map<string, number>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const part = await fetchQuoteChunk(chunk);
      for (const [k, v] of part) out.set(k, v);
    } catch {
      try {
        const part = await fetchSparkChunk(chunk);
        for (const [k, v] of part) out.set(k, v);
      } catch {
        /* این دسته رد می‌شود */
      }
    }
  }
  return out;
}
