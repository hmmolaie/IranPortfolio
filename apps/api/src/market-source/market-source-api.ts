import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_BITPIN_MARKETS_URL = 'https://api.bitpin.ir/v1/mkt/markets/';
export const DEFAULT_YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';

const CONFIG_ID = 'default';

export type MarketSourceApi = {
  bitpinMarketsUrl: string;
  yahooQuoteUrl: string;
};

export async function readMarketSourceApi(prisma: PrismaService): Promise<MarketSourceApi> {
  const row = await prisma.worldSourceApiConfig.findUnique({ where: { id: CONFIG_ID } });
  return {
    bitpinMarketsUrl: row?.bitpinMarketsUrl?.trim() || DEFAULT_BITPIN_MARKETS_URL,
    yahooQuoteUrl: row?.yahooQuoteUrl?.trim() || DEFAULT_YAHOO_QUOTE_URL,
  };
}

export function normalizeMarketSourceUrl(raw: string, labelFa: string): string {
  const t = raw.trim();
  if (!t) throw new BadRequestException(`${labelFa} را وارد کنید`);
  if (t.length > 500) throw new BadRequestException(`${labelFa} بیش از حد طولانی است`);
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new BadRequestException(`${labelFa} نامعتبر است`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException(`${labelFa} باید با http یا https باشد`);
  }
  if (!url.hostname.includes('.')) {
    throw new BadRequestException(`${labelFa} نامعتبر است`);
  }
  return url.toString();
}

export async function saveMarketSourceApi(
  prisma: PrismaService,
  data: { bitpinMarketsUrl: string; yahooQuoteUrl: string },
): Promise<MarketSourceApi> {
  const bitpinMarketsUrl = normalizeMarketSourceUrl(data.bitpinMarketsUrl, 'آدرس API بیت‌پین');
  const yahooQuoteUrl = normalizeMarketSourceUrl(data.yahooQuoteUrl, 'آدرس API یاهو فایننس');
  await prisma.worldSourceApiConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, bitpinMarketsUrl, yahooQuoteUrl },
    update: { bitpinMarketsUrl, yahooQuoteUrl },
  });
  return { bitpinMarketsUrl, yahooQuoteUrl };
}
