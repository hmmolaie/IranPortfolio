import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** یکسان‌سازی نماد: ی و ک عربی، فاصله و نیم‌فاصله */
export function tickerKey(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎\s]/g, '')
    .trim();
}

/** یکسان‌سازی نام شرکت برای تطبیق نام کامل گزارش صندوق با نام بورسی */
export function companyKey(value: string): string {
  return tickerKey(value)
    .replace(/[()«»"'.\-ـ،,؛:/\\]/g, '')
    .replace(/سهامیعام|سهامیخاص|شرکت|سهامی/g, '')
    .replace(/[0-9۰-۹]/g, '');
}

export type TickerResolver = (symbol: string | null | undefined, nameFa?: string | null) => string | null;

/**
 * نماد یا نام سهمی که مدل از گزارش صندوق خوانده را به نماد بورسی همان سهم برمی‌گرداند.
 * اول خود نماد، بعد نام کامل شرکت با نام بورسی مقایسه می‌شود. اگر پیدا نشد null.
 */
export async function loadTickerResolver(prisma: PrismaService): Promise<TickerResolver> {
  const rows = await prisma.instrument.findMany({
    where: { assetType: AssetType.STOCK },
    select: { symbol: true, nameFa: true, isActive: true },
  });
  const bySymbol = new Map<string, string>();
  const byName = new Map<string, string>();
  // نماد فعال بر غیرفعال مقدم است
  rows.sort((a, b) => Number(a.isActive) - Number(b.isActive));
  for (const row of rows) {
    bySymbol.set(tickerKey(row.symbol), row.symbol);
    const name = companyKey(row.nameFa ?? '');
    if (name.length >= 3) byName.set(name, row.symbol);
  }
  return (symbol, nameFa) => {
    const candidates = [symbol, nameFa].filter((v): v is string => !!v && !!v.trim());
    for (const c of candidates) {
      const hit = bySymbol.get(tickerKey(c));
      if (hit) return hit;
    }
    for (const c of candidates) {
      const key = companyKey(c);
      if (key.length < 3) continue;
      const hit = byName.get(key);
      if (hit) return hit;
    }
    return null;
  };
}
