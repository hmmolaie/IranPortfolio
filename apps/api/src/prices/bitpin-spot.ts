/** بیت‌پین قیمت‌های IRT را به تومان می‌دهد؛ سبدیار ریال ذخیره می‌کند */
export const BITPIN_MARKETS_URL = 'https://api.bitpin.ir/v1/mkt/markets/';
export const BITPIN_TOMAN_TO_RIAL = 10;
export const TROY_OUNCE_GRAMS = 31.1034768;
export const KARAT_18_OF_24 = 18 / 24;

const USD_MARKET_CODES = ['USDT_IRT'];
const GOLD_OZ_MARKET_CODES = ['PAXG_IRT', 'XAUT_IRT'];

export type BitpinSpotParse = {
  usdIrr: number | null;
  goldGramRial: number | null;
  usdtToman: number | null;
  goldOzToman: number | null;
  usdMarket: string | null;
  goldMarket: string | null;
};

function asFinite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function pickPrice(row: { priceNum?: number | null; price?: unknown }): number | null {
  return asFinite(row.priceNum) ?? asFinite(row.price);
}

export function extractBitpinSpot(
  markets: Array<{ code?: string | null; priceNum?: number | null; price?: unknown }>,
): BitpinSpotParse {
  const byCode = new Map<string, { priceNum?: number | null; price?: unknown }>();
  for (const m of markets) {
    const code = (m.code ?? '').trim().toUpperCase();
    if (code) byCode.set(code, m);
  }

  let usdMarket: string | null = null;
  let usdtToman: number | null = null;
  for (const code of USD_MARKET_CODES) {
    const row = byCode.get(code);
    const p = row ? pickPrice(row) : null;
    if (p) {
      usdMarket = code;
      usdtToman = p;
      break;
    }
  }

  let goldMarket: string | null = null;
  let goldOzToman: number | null = null;
  for (const code of GOLD_OZ_MARKET_CODES) {
    const row = byCode.get(code);
    const p = row ? pickPrice(row) : null;
    if (p) {
      goldMarket = code;
      goldOzToman = p;
      break;
    }
  }

  const usdIrr = usdtToman != null ? Math.round(usdtToman * BITPIN_TOMAN_TO_RIAL) : null;
  const goldGramRial =
    goldOzToman != null
      ? Math.round((goldOzToman / TROY_OUNCE_GRAMS) * KARAT_18_OF_24 * BITPIN_TOMAN_TO_RIAL)
      : null;

  return { usdIrr, goldGramRial, usdtToman, goldOzToman, usdMarket, goldMarket };
}
