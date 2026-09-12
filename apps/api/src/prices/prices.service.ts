import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateKey } from '../news/tehran-date';

type ParsedSpot = {
  usdIrr: number | null;
  goldGramRial: number | null;
};

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** استخراج انعطاف‌پذیر فیلدها از JSONهای رایج APIهای قیمت ایران */
function extractSpotPrices(payload: unknown): ParsedSpot {
  const usdKeys = [
    'usdIrr',
    'usd',
    'USD',
    'dollar',
    'Dollar',
    'price_dollar_rl',
    'free_dollar',
    'usd_sell',
    'usdSell',
    'dollar_sell',
    'usdt',
    'USDT',
  ];
  const goldKeys = [
    'goldGramRial',
    'gold',
    'GOLD',
    'gold18',
    'gold_18',
    'geram18',
    'geram_18',
    'price_gold_18ayar',
    'gold_sell',
    'goldSell',
    'ons',
  ];

  let usdIrr: number | null = null;
  let goldGramRial: number | null = null;

  const visit = (node: unknown, depth = 0) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    for (const k of Object.keys(obj)) {
      const lower = k.toLowerCase();
      const val = obj[k];

      if (usdIrr == null && usdKeys.some((x) => x.toLowerCase() === lower)) {
        usdIrr = toNumber(val) ?? toNumber((val as { value?: unknown; price?: unknown })?.value) ?? toNumber((val as { price?: unknown })?.price);
      }
      if (goldGramRial == null && goldKeys.some((x) => x.toLowerCase() === lower)) {
        goldGramRial =
          toNumber(val) ??
          toNumber((val as { value?: unknown; price?: unknown })?.value) ??
          toNumber((val as { price?: unknown })?.price);
      }

      // برخی APIها: { symbol: "USD", price: 600000 }
      if (typeof val === 'object' && val) {
        const rec = val as Record<string, unknown>;
        const sym = String(rec.symbol ?? rec.code ?? rec.name ?? '').toUpperCase();
        if (usdIrr == null && (sym === 'USD' || sym === 'DOLLAR' || /دلار/.test(String(rec.name ?? '')))) {
          usdIrr = toNumber(rec.price ?? rec.value ?? rec.sell);
        }
        if (
          goldGramRial == null &&
          (sym.includes('GOLD') || /طلا|عیار/.test(String(rec.name ?? '')))
        ) {
          goldGramRial = toNumber(rec.price ?? rec.value ?? rec.sell);
        }
      }
    }

    for (const v of Object.values(obj)) {
      if (typeof v === 'object') visit(v, depth + 1);
    }
  };

  visit(payload);

  // اگر طلا به تومان بود (عدد خیلی کوچک نسبت به دلار ریالی)، تبدیل نکن؛ فرض ریال است
  // اگر عدد طلا < دلار، احتمالاً گرم به تومان است → ×۱۰
  if (usdIrr && goldGramRial && goldGramRial < usdIrr / 10) {
    goldGramRial = goldGramRial * 10;
  }

  return { usdIrr, goldGramRial };
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(private readonly prisma: PrismaService) {}

  getConfig() {
    return this.prisma.spotPriceApiConfig.findUnique({ where: { id: 'default' } });
  }

  /** بررسی می‌کند آدرس واقعاً JSON برمی‌گرداند */
  private async assertUriReturnsJson(uri: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(uri, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new BadRequestException(
        `امکان اتصال به آدرس API نیست: ${(e as Error).message || 'خطای شبکه'}`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(
        `آدرس API پاسخ موفق برنگرداند (کد ${res.status}). ذخیره انجام نشد.`,
      );
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BadRequestException(
        'این نشانی JSON معتبر برنمی‌گرداند. لطفاً آدرسی وارد کنید که پاسخ آن JSON باشد.',
      );
    }

    if (json === null || (typeof json !== 'object' && !Array.isArray(json))) {
      throw new BadRequestException(
        'پاسخ این نشانی JSON شیء یا آرایه نیست. ذخیره انجام نشد.',
      );
    }

    // اگر Content-Type مشخصاً غیر JSON بود ولی parse شد، قبول می‌کنیم
    if (contentType && !contentType.includes('json') && !contentType.includes('text/plain')) {
      this.logger.warn(`Content-Type غیرمنتظره برای API قیمت: ${contentType}`);
    }

    return json;
  }

  async saveConfig(uri: string) {
    const trimmed = uri.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new BadRequestException('آدرس API باید با http یا https شروع شود');
    }

    await this.assertUriReturnsJson(trimmed);

    return this.prisma.spotPriceApiConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', uri: trimmed },
      update: { uri: trimmed },
    });
  }

  async latest() {
    return this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } });
  }

  /** ثبت دستی نرخ دلار (و اختیاری طلا) برای امروز به وقت ایران */
  async upsertManualSpot(input: { usdIrr?: number; goldGramRial?: number }) {
    if (
      (input.usdIrr == null || !(input.usdIrr > 0)) &&
      (input.goldGramRial == null || !(input.goldGramRial > 0))
    ) {
      throw new BadRequestException('حداقل یک نرخ معتبر دلار یا طلا لازم است');
    }

    const dateKey = tehranDateKey();
    const asOfDate = new Date(`${dateKey}T12:00:00+03:30`);
    const existing = await this.prisma.spotPriceDaily.findUnique({ where: { dateKey } });

    const usdIrr = input.usdIrr != null && input.usdIrr > 0 ? input.usdIrr : existing?.usdIrr ?? undefined;
    const goldGramRial =
      input.goldGramRial != null && input.goldGramRial > 0
        ? input.goldGramRial
        : existing?.goldGramRial ?? undefined;

    const row = await this.prisma.spotPriceDaily.upsert({
      where: { dateKey },
      create: {
        dateKey,
        asOfDate,
        usdIrr,
        goldGramRial,
        sourceRaw: { source: 'manual', at: new Date().toISOString() },
      },
      update: {
        asOfDate,
        ...(input.usdIrr != null && input.usdIrr > 0 ? { usdIrr: input.usdIrr } : {}),
        ...(input.goldGramRial != null && input.goldGramRial > 0
          ? { goldGramRial: input.goldGramRial }
          : {}),
        sourceRaw: { source: 'manual', at: new Date().toISOString() },
      },
    });

    if (row.usdIrr != null && row.usdIrr > 0) {
      const macroDate = new Date(dateKey + 'T00:00:00.000Z');
      await this.prisma.macroSnapshot.upsert({
        where: { asOfDate: macroDate },
        create: { asOfDate: macroDate, usdIrr: row.usdIrr },
        update: { usdIrr: row.usdIrr },
      });
    }

    return row;
  }

  async history(days = 90) {
    const take = Math.min(Math.max(days, 1), 730);
    const rows = await this.prisma.spotPriceDaily.findMany({
      orderBy: { dateKey: 'desc' },
      take,
    });
    return rows.reverse();
  }

  /** هر روز ۱۲:۰۰ ظهر به وقت ایران ≈ ۰۸:۳۰ UTC */
  @Cron('30 8 * * *')
  async scheduledRefresh() {
    this.logger.log('بروزرسانی زمان‌بندی‌شده قیمت دلار و طلا (۱۲ ظهر ایران)');
    try {
      await this.refreshFromApi();
    } catch (e) {
      this.logger.error(`خطا در بروزرسانی قیمت: ${(e as Error).message}`);
    }
  }

  async refreshFromApi() {
    const config = await this.getConfig();
    if (!config?.uri) {
      throw new BadRequestException('ابتدا آدرس API قیمت را در تنظیمات ذخیره کنید');
    }

    const res = await fetch(config.uri, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BadRequestException(`خطای API قیمت: ${res.status} ${text.slice(0, 300)}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BadRequestException('پاسخ API قیمت JSON معتبر نیست');
    }

    const parsed = extractSpotPrices(json);
    if (parsed.usdIrr == null && parsed.goldGramRial == null) {
      throw new BadRequestException(
        'در JSON دریافتی فیلد دلار یا طلا پیدا نشد. نمونه کلیدها: usd, dollar, gold, gold18',
      );
    }

    const dateKey = tehranDateKey();
    const asOfDate = new Date(`${dateKey}T12:00:00+03:30`);

    const row = await this.prisma.spotPriceDaily.upsert({
      where: { dateKey },
      create: {
        dateKey,
        asOfDate,
        usdIrr: parsed.usdIrr ?? undefined,
        goldGramRial: parsed.goldGramRial ?? undefined,
        sourceRaw: json as object,
      },
      update: {
        usdIrr: parsed.usdIrr ?? undefined,
        goldGramRial: parsed.goldGramRial ?? undefined,
        sourceRaw: json as object,
        asOfDate,
      },
    });

    // همگام‌سازی نرخ دلار با MacroSnapshot برای بقیهٔ سیستم
    if (parsed.usdIrr != null) {
      const macroDate = new Date(dateKey + 'T00:00:00.000Z');
      await this.prisma.macroSnapshot.upsert({
        where: { asOfDate: macroDate },
        create: { asOfDate: macroDate, usdIrr: parsed.usdIrr },
        update: { usdIrr: parsed.usdIrr },
      });
    }

    this.logger.log(
      `قیمت ${dateKey}: دلار=${parsed.usdIrr ?? '—'} طلاگرم=${parsed.goldGramRial ?? '—'}`,
    );
    return row;
  }
}
