export type AssetKind = 'FIAT' | 'CRYPTO' | 'METAL';

export type CurrencyMeta = {
  code: string;
  nameFa: string;
  kind: AssetKind;
};

export type PairDef = {
  base: string;
  quote: string;
  yahoo: string;
};

export const FOREX_CURRENCIES: Record<string, CurrencyMeta> = {
  USD: { code: 'USD', nameFa: 'دلار آمریکا', kind: 'FIAT' },
  EUR: { code: 'EUR', nameFa: 'یورو', kind: 'FIAT' },
  GBP: { code: 'GBP', nameFa: 'پوند بریتانیا', kind: 'FIAT' },
  JPY: { code: 'JPY', nameFa: 'ین ژاپن', kind: 'FIAT' },
  CHF: { code: 'CHF', nameFa: 'فرانک سوئیس', kind: 'FIAT' },
  AUD: { code: 'AUD', nameFa: 'دلار استرالیا', kind: 'FIAT' },
  CAD: { code: 'CAD', nameFa: 'دلار کانادا', kind: 'FIAT' },
  NZD: { code: 'NZD', nameFa: 'دلار نیوزیلند', kind: 'FIAT' },
  CNY: { code: 'CNY', nameFa: 'یوان چین', kind: 'FIAT' },
  HKD: { code: 'HKD', nameFa: 'دلار هنگ‌کنگ', kind: 'FIAT' },
  SGD: { code: 'SGD', nameFa: 'دلار سنگاپور', kind: 'FIAT' },
  SEK: { code: 'SEK', nameFa: 'کرون سوئد', kind: 'FIAT' },
  NOK: { code: 'NOK', nameFa: 'کرون نروژ', kind: 'FIAT' },
  MXN: { code: 'MXN', nameFa: 'پزو مکزیک', kind: 'FIAT' },
  BTC: { code: 'BTC', nameFa: 'بیت‌کوین', kind: 'CRYPTO' },
  ETH: { code: 'ETH', nameFa: 'اتریوم', kind: 'CRYPTO' },
  XAU: { code: 'XAU', nameFa: 'طلا', kind: 'METAL' },
  XAG: { code: 'XAG', nameFa: 'نقره', kind: 'METAL' },
};

/** ۲۰ جفت‌ارز معروف + بیت‌کوین، اتریوم، طلا، نقره (و چند اتصال کمکی برای گراف) */
export const FOREX_PAIRS: PairDef[] = [
  { base: 'EUR', quote: 'USD', yahoo: 'EURUSD=X' },
  { base: 'GBP', quote: 'USD', yahoo: 'GBPUSD=X' },
  { base: 'USD', quote: 'JPY', yahoo: 'USDJPY=X' },
  { base: 'USD', quote: 'CHF', yahoo: 'USDCHF=X' },
  { base: 'AUD', quote: 'USD', yahoo: 'AUDUSD=X' },
  { base: 'USD', quote: 'CAD', yahoo: 'USDCAD=X' },
  { base: 'NZD', quote: 'USD', yahoo: 'NZDUSD=X' },
  { base: 'EUR', quote: 'GBP', yahoo: 'EURGBP=X' },
  { base: 'EUR', quote: 'JPY', yahoo: 'EURJPY=X' },
  { base: 'GBP', quote: 'JPY', yahoo: 'GBPJPY=X' },
  { base: 'EUR', quote: 'AUD', yahoo: 'EURAUD=X' },
  { base: 'EUR', quote: 'CHF', yahoo: 'EURCHF=X' },
  { base: 'AUD', quote: 'JPY', yahoo: 'AUDJPY=X' },
  { base: 'GBP', quote: 'AUD', yahoo: 'GBPAUD=X' },
  { base: 'USD', quote: 'CNY', yahoo: 'USDCNY=X' },
  { base: 'USD', quote: 'HKD', yahoo: 'USDHKD=X' },
  { base: 'USD', quote: 'SGD', yahoo: 'USDSGD=X' },
  { base: 'USD', quote: 'SEK', yahoo: 'USDSEK=X' },
  { base: 'USD', quote: 'NOK', yahoo: 'USDNOK=X' },
  { base: 'USD', quote: 'MXN', yahoo: 'USDMXN=X' },
  { base: 'BTC', quote: 'USD', yahoo: 'BTC-USD' },
  { base: 'ETH', quote: 'USD', yahoo: 'ETH-USD' },
  { base: 'ETH', quote: 'BTC', yahoo: 'ETH-BTC' },
  { base: 'BTC', quote: 'EUR', yahoo: 'BTC-EUR' },
  { base: 'ETH', quote: 'EUR', yahoo: 'ETH-EUR' },
  { base: 'XAU', quote: 'USD', yahoo: 'XAUUSD=X' },
  { base: 'XAG', quote: 'USD', yahoo: 'XAGUSD=X' },
];

export function pairSymbol(base: string, quote: string): string {
  return `${base}/${quote}`;
}

export function currencyMeta(code: string): CurrencyMeta {
  return (
    FOREX_CURRENCIES[code] ?? {
      code,
      nameFa: code,
      kind: 'FIAT',
    }
  );
}
