import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/secret-box';

export const DEFAULT_BRS_BASE_URL = 'https://Api.BrsApi.ir';
const CONFIG_ID = 'default';

/** مسیرهایی که با همین کلید روی Api.BrsApi.ir جواب دادند یا در راهنمای همان سرویس هستند. */
export const BRS_FUNCTIONS = [
  {
    id: 'TSETMC_AllSymbols',
    nameFa: 'همه نمادهای بورس',
    path: '/Tsetmc/AllSymbols.php',
    paramsFa: 'type اختیاری: ۱ سهام و صندوق، ۲ کالا، ۳ آتی، ۴ اوراق بدهی، ۵ تسهیلات مسکن',
    dailyQuota: '۱۰۰',
    usedByApp: true,
  },
  {
    id: 'TSETMC_Index',
    nameFa: 'شاخص‌های بورس',
    path: '/Tsetmc/Index.php',
    paramsFa: 'type برابر ۱ برای شاخص کل و هم‌وزن',
    dailyQuota: '۱۰۰',
    usedByApp: true,
  },
  {
    id: 'TSETMC_Symbol',
    nameFa: 'دیتای جامع نماد بورسی',
    path: '/Tsetmc/Symbol.php',
    paramsFa: 'l18 نماد، مثلاً فملی',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'TSETMC_Nav',
    nameFa: 'Nav صندوق‌های ETF',
    path: '/Tsetmc/Nav.php',
    paramsFa: 'l18 نماد صندوق',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'TSETMC_Option',
    nameFa: 'بازار آپشن بورس',
    path: '/Tsetmc/Option.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: true,
  },
  {
    id: 'TSETMC_Transaction',
    nameFa: 'ریزمعاملات بورس',
    path: '/Tsetmc/Transaction.php',
    paramsFa: 'بدون نماد پاسخ نمی‌دهد؛ l18 لازم است',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'TSETMC_History',
    nameFa: 'دیتای تاریخی بورس',
    path: '/Tsetmc/History.php',
    paramsFa: 'type برابر ۰ قیمت و ۱ حقیقی/حقوقی، به‌علاوه l18',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'TSETMC_Candlestick',
    nameFa: 'کندل‌استیک بورس',
    path: '/Tsetmc/Candlestick.php',
    paramsFa: 'type برابر ۱ لحظه‌ای، ۲ تعدیل‌نشده، ۳ تعدیل‌شده، به‌علاوه l18',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'TSETMC_Shareholder',
    nameFa: 'سهامداران بورس',
    path: '/Tsetmc/Shareholder.php',
    paramsFa: 'l18 و date اختیاری به شکل ۱۴۰۴-۰۲-۲۲',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'CODAL_Announcement',
    nameFa: 'اطلاعیه‌های کدال',
    path: '/Codal/Announcement.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'IME_Futures',
    nameFa: 'آتی بورس کالا',
    path: '/IME/Futures.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'IME_Option',
    nameFa: 'آپشن بورس کالا',
    path: '/IME/Option.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'IME_Certificate',
    nameFa: 'گواهی سپرده کالایی',
    path: '/IME/Certificate.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'IME_Fund',
    nameFa: 'صندوق‌های کالایی بورس کالا',
    path: '/IME/Fund.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'IME_Physical',
    nameFa: 'معاملات فیزیکی بورس کالا',
    path: '/IME/Physical.php',
    paramsFa: 'بدون پارامتر اضافه',
    dailyQuota: '۱۰',
    usedByApp: false,
  },
  {
    id: 'Market_CGCC',
    nameFa: 'کامودیتی، طلا و ارز، ارز دیجیتال',
    path: '/Market/Gold_Currency.php',
    paramsFa: 'طلا و ارز از همین مسیر؛ کامودیتی از /Market/Commodity.php',
    dailyQuota: '۱۵۰۰',
    usedByApp: false,
  },
  {
    id: 'Market_GCC_Pro',
    nameFa: 'طلا و ارز حرفه‌ای',
    path: '/Market/Gold_Currency_Pro.php',
    paramsFa: 'section برابر gold یا currency یا cryptocurrency. روی این کلید سهمیه ندارد.',
    dailyQuota: '۰',
    usedByApp: false,
  },
] as const;

export type BrsFunctionInfo = (typeof BRS_FUNCTIONS)[number];

function encKey(): string {
  return process.env.LLM_TOKEN_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';
}

export function normalizeBrsBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) return DEFAULT_BRS_BASE_URL;
  if (t.length > 300) throw new BadRequestException('نشانی پایه بیش از حد طولانی است');
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    throw new BadRequestException('نشانی پایه نامعتبر است');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('نشانی پایه باید با http یا https باشد');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new BadRequestException('نشانی پایه فقط دامنه است، بدون مسیر اضافه');
  }
  return url.origin;
}

export function brsEndpoint(
  baseUrl: string,
  path: string,
  apiKey: string,
  query: Record<string, string> = {},
): string {
  const root = (baseUrl.trim() || DEFAULT_BRS_BASE_URL).replace(/\/+$/, '');
  const url = new URL(path.replace(/^\//, ''), `${root}/`);
  url.searchParams.set('key', apiKey);
  for (const [name, value] of Object.entries(query)) {
    if (value) url.searchParams.set(name, value);
  }
  return url.toString();
}

export function redactBrsUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]+/gi, '$1[redacted]');
}

export async function readBrsApiPublic(prisma: PrismaService) {
  const row = await prisma.iranMarketApiConfig.findUnique({ where: { id: CONFIG_ID } });
  return {
    baseUrl: row?.baseUrl?.trim() || DEFAULT_BRS_BASE_URL,
    hasToken: Boolean(row?.apiTokenEncrypted),
    functions: BRS_FUNCTIONS,
  };
}

/** اگر توکن ادمین خالی باشد، کلید محیط فقط تا زمان ذخیره در تنظیمات استفاده می‌شود. */
export async function readBrsApiAccess(
  prisma: PrismaService,
): Promise<{ baseUrl: string; apiKey: string } | null> {
  const row = await prisma.iranMarketApiConfig.findUnique({ where: { id: CONFIG_ID } });
  const baseUrl = row?.baseUrl?.trim() || DEFAULT_BRS_BASE_URL;
  let apiKey = '';
  if (row?.apiTokenEncrypted) {
    try {
      apiKey = decryptSecret(encKey(), row.apiTokenEncrypted).trim();
    } catch {
      apiKey = '';
    }
  }
  if (!apiKey) apiKey = process.env.BRS_API_KEY?.trim() ?? '';
  if (!apiKey) return null;
  return { baseUrl, apiKey };
}

export async function saveBrsApiConfig(
  prisma: PrismaService,
  data: { baseUrl?: string; apiToken?: string },
) {
  const current = await prisma.iranMarketApiConfig.findUnique({ where: { id: CONFIG_ID } });
  const baseUrl = normalizeBrsBaseUrl(data.baseUrl ?? current?.baseUrl ?? DEFAULT_BRS_BASE_URL);
  let apiTokenEncrypted = current?.apiTokenEncrypted ?? null;
  const token = data.apiToken?.trim();
  if (token) {
    if (token.length < 8 || token.length > 200) {
      throw new BadRequestException('توکن نامعتبر است');
    }
    apiTokenEncrypted = encryptSecret(encKey(), token);
  }
  await prisma.iranMarketApiConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, baseUrl, apiTokenEncrypted },
    update: { baseUrl, apiTokenEncrypted },
  });
  return readBrsApiPublic(prisma);
}
