import { Injectable, Logger } from '@nestjs/common';
import { AssetType, SnapshotKind } from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { CodalService } from '../market/codal.service';
import { PortfoliosService } from './portfolios.service';

const DAY_MS = 86_400_000;
/** نقطه‌های سنجش بازده بعد از هر ساخت سبد (روز) */
const CHECKPOINT_DAYS = [30, 90, 180];
/** چند ساخت یا بازچینش آخر در کارنامه */
const MAX_BUILDS = 4;
/** حداکثر نمادهایی که برای رویدادهای کدال خوانده می‌شود */
const MAX_CODAL_SYMBOLS = 12;
const CODAL_CONCURRENCY = 3;

const EVENT_FA: Record<string, string> = {
  BUY: 'خرید',
  SELL: 'فروش',
  DEPOSIT_CASH: 'واریز نقد',
  WITHDRAW_CASH: 'برداشت نقد',
  WEIGHT_EDIT: 'ویرایش',
  ACCEPT_REBALANCE: 'پذیرش بازچینش',
  REJECT_REBALANCE: 'رد بازچینش',
};

const ASSET_FA: Record<string, string> = {
  STOCK: 'سهام',
  GOLD_ETF: 'صندوق طلا',
  FUND: 'صندوق',
  DEPOSIT: 'سپرده',
  CASH: 'نقد',
  PHYSICAL_GOLD: 'طلای فیزیکی',
  PHYSICAL_USD: 'دلار فیزیکی',
  OPTION: 'اختیار معامله',
  INDEX: 'شاخص',
};

export type CodalEventKind = 'assembly' | 'capital' | 'dividend' | 'financial';

const CODAL_KIND_FA: Record<CodalEventKind, string> = {
  assembly: 'مجمع',
  capital: 'افزایش سرمایه',
  dividend: 'سود نقدی',
  financial: 'صورت مالی',
};

function codalKind(title: string): CodalEventKind | null {
  const t = title.replace(/\s+/g, ' ');
  if (/افزایش\s*سرمایه/.test(t)) return 'capital';
  if (/مجمع/.test(t)) return 'assembly';
  if (/سود\s*(نقدی|سهام)|تقسیم\s*سود|DPS/i.test(t)) return 'dividend';
  if (/صورت(‌|\s)?(های|ها)?\s*مالی|اطلاعات\s*و\s*صورت/.test(t)) return 'financial';
  return null;
}

function pct(from: number, to: number): number | null {
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/** کارنامهٔ سبد، خروجی Excel و رویدادهای کدال سهم‌های سبد؛ بدون مدل و فقط از دیتابیس */
@Injectable()
export class PortfolioInsightsService {
  private readonly logger = new Logger(PortfolioInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolios: PortfoliosService,
    private readonly codal: CodalService,
  ) {}

  /**
   * بازده هر سبدی که System One ساخته یا بازچینش کرده، با همان تعداد واحدهای همان روز،
   * ۱ و ۳ و ۶ ماه بعد و امروز؛ کنار تغییر دلار و طلا در همان بازه.
   */
  async trackRecord(userId: string, portfolioId: string, isAdmin = false) {
    const portfolio = await this.portfolios.get(userId, portfolioId, isAdmin);
    const builds = portfolio.snapshots
      .filter((s) => s.kind === SnapshotKind.SUGGESTION || s.kind === SnapshotKind.REBALANCE)
      .slice(0, MAX_BUILDS);
    const now = new Date();
    const rows = [];
    for (const build of builds) {
      const items = build.items.filter((item) => (Number(item.amountRial) || 0) > 0);
      const start = items.reduce((sum, item) => sum + (Number(item.amountRial) || 0), 0);
      if (!(start > 0)) continue;
      const startSpot = await this.spotAt(build.createdAt);
      const points: Array<{
        labelFa: string;
        days: number;
        valuePct: number | null;
        usdPct: number | null;
        goldPct: number | null;
      }> = [];
      const ages = CHECKPOINT_DAYS.filter((d) => build.createdAt.getTime() + d * DAY_MS <= now.getTime());
      const dates: Array<{ labelFa: string; days: number; at: Date }> = ages.map((d) => ({
        labelFa: `${Math.round(d / 30).toLocaleString('fa-IR')} ماه بعد`,
        days: d,
        at: new Date(build.createdAt.getTime() + d * DAY_MS),
      }));
      const ageDays = Math.floor((now.getTime() - build.createdAt.getTime()) / DAY_MS);
      dates.push({ labelFa: 'امروز', days: ageDays, at: now });
      for (const point of dates) {
        const [value, spot] = await Promise.all([this.valueAt(items, point.at, startSpot), this.spotAt(point.at)]);
        points.push({
          labelFa: point.labelFa,
          days: point.days,
          valuePct: value == null ? null : pct(start, value),
          usdPct: startSpot?.usdIrr && spot?.usdIrr ? pct(startSpot.usdIrr, spot.usdIrr) : null,
          goldPct: startSpot?.goldGramRial && spot?.goldGramRial ? pct(startSpot.goldGramRial, spot.goldGramRial) : null,
        });
      }
      rows.push({
        snapshotId: build.id,
        kind: build.kind,
        createdAt: build.createdAt,
        investedRial: start,
        items: items.length,
        points,
      });
    }
    return {
      noteFa:
        'بازده با همان تعداد واحدهایی حساب شده که هر نسخه در روز ساخت داشت؛ معامله‌ها و کارمزد بعدی و سود سپرده در آن نیست. نتیجهٔ گذشته آینده را تضمین نمی‌کند.',
      builds: rows,
    };
  }

  /** ارزش اقلام در یک تاریخ: سهم و صندوق با آخرین قیمت تا آن روز، طلا و دلار فیزیکی با نسبت قیمت روز */
  private async valueAt(
    items: Array<{
      assetType: AssetType;
      instrumentId: string | null;
      quantity: number;
      amountRial: number;
    }>,
    at: Date,
    startSpot: { usdIrr: number | null; goldGramRial: number | null } | null,
  ): Promise<number | null> {
    const ids = [...new Set(items.map((i) => i.instrumentId).filter((id): id is string => !!id))];
    const prices = new Map<string, number>();
    if (ids.length) {
      const bars = await this.prisma.priceBar.findMany({
        where: {
          instrumentId: { in: ids },
          tradeDate: { lte: at, gte: new Date(at.getTime() - 20 * DAY_MS) },
        },
        orderBy: [{ instrumentId: 'asc' }, { tradeDate: 'desc' }],
        distinct: ['instrumentId'],
        select: { instrumentId: true, lastPrice: true, closePrice: true },
      });
      for (const bar of bars) {
        const price = bar.lastPrice ?? bar.closePrice;
        if (price != null && price > 0) prices.set(bar.instrumentId, price);
      }
    }
    const spot = await this.spotAt(at);
    let total = 0;
    for (const item of items) {
      const amount = Number(item.amountRial) || 0;
      const qty = Number(item.quantity) || 0;
      if (item.instrumentId && prices.has(item.instrumentId) && qty > 0) {
        total += prices.get(item.instrumentId)! * qty;
      } else if (item.assetType === AssetType.PHYSICAL_GOLD && startSpot?.goldGramRial && spot?.goldGramRial) {
        total += amount * (spot.goldGramRial / startSpot.goldGramRial);
      } else if (item.assetType === AssetType.PHYSICAL_USD && startSpot?.usdIrr && spot?.usdIrr) {
        total += amount * (spot.usdIrr / startSpot.usdIrr);
      } else {
        total += amount;
      }
    }
    return total;
  }

  private spotAt(at: Date) {
    return this.prisma.spotPriceDaily.findFirst({
      where: { asOfDate: { lte: at } },
      orderBy: { asOfDate: 'desc' },
      select: { usdIrr: true, goldGramRial: true },
    });
  }

  /** فایل Excel با سه برگه: خلاصه، اقلام نسخهٔ فعلی با سود و زیان و کارمزد، و رویدادها */
  async exportXlsx(userId: string, portfolioId: string, isAdmin = false): Promise<{ fileName: string; buffer: Buffer }> {
    const p = await this.portfolios.get(userId, portfolioId, isAdmin);
    const latest = p.snapshots[0];
    const items = (latest?.items ?? []) as Array<{
      symbol: string;
      assetType: string;
      quantity: number;
      amountRial: number;
      weightPct: number;
      avgBuyPrice?: number | null;
      lastPrice?: number | null;
      costBasisRial?: number | null;
      marketValueRial?: number | null;
      feeRial?: number | null;
      pnlRial?: number | null;
      reasonFa?: string | null;
    }>;
    const summary = [
      { عنوان: 'نام سبد', مقدار: p.name },
      { عنوان: 'سرمایه (ریال)', مقدار: p.capitalRial },
      { عنوان: 'نقد (ریال)', مقدار: p.cashRial },
      { عنوان: 'تاریخ ساخت', مقدار: p.createdAt.toISOString().slice(0, 10) },
      { عنوان: 'تاریخ خروجی', مقدار: new Date().toISOString().slice(0, 10) },
      {
        عنوان: 'جمع ارزش روز اقلام (ریال)',
        مقدار: Math.round(items.reduce((s, i) => s + (Number(i.marketValueRial ?? i.amountRial) || 0), 0)),
      },
      {
        عنوان: 'جمع سود و زیان پس از کارمزد (ریال)',
        مقدار: Math.round(items.reduce((s, i) => s + (Number(i.pnlRial) || 0), 0)),
      },
      {
        عنوان: 'جمع کارمزد (ریال)',
        مقدار: Math.round(items.reduce((s, i) => s + (Number(i.feeRial) || 0), 0)),
      },
    ];
    const itemRows = items.map((i) => ({
      نماد: i.symbol,
      نوع: ASSET_FA[i.assetType] ?? i.assetType,
      تعداد: i.quantity,
      'وزن ٪': Math.round((Number(i.weightPct) || 0) * 100) / 100,
      'میانگین خرید': i.avgBuyPrice ?? null,
      'آخرین قیمت': i.lastPrice ?? null,
      'بهای تمام‌شده': i.costBasisRial != null ? Math.round(i.costBasisRial) : Math.round(i.amountRial),
      'ارزش روز': i.marketValueRial != null ? Math.round(i.marketValueRial) : null,
      کارمزد: i.feeRial != null ? Math.round(i.feeRial) : null,
      'سود و زیان': i.pnlRial != null ? Math.round(i.pnlRial) : null,
      دلیل: i.reasonFa ?? '',
    }));
    const eventRows = (p.events ?? []).map((e) => ({
      تاریخ: e.createdAt.toISOString().replace('T', ' ').slice(0, 16),
      نوع: EVENT_FA[e.type] ?? e.type,
      توضیح: e.noteFa ?? '',
    }));

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'خلاصه');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows.length ? itemRows : [{ نماد: '' }]), 'اقلام');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventRows.length ? eventRows : [{ تاریخ: '' }]), 'رویدادها');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    return { fileName: `sabadyar-${p.id}.xlsx`, buffer };
  }

  /**
   * مجمع، افزایش سرمایه، سود نقدی و صورت مالی سهم‌ها و صندوق‌های همین سبد از اطلاعیه‌های کدال.
   * هر نماد در هر روز فقط یک‌بار از کدال خوانده می‌شود (همان قاعدهٔ صفحهٔ سهم).
   */
  async codalEvents(userId: string, portfolioId: string, isAdmin = false) {
    const p = await this.portfolios.get(userId, portfolioId, isAdmin);
    const held = (p.snapshots[0]?.items ?? []).filter(
      (i) =>
        i.instrumentId &&
        (i.assetType === AssetType.STOCK || i.assetType === AssetType.FUND || i.assetType === AssetType.GOLD_ETF),
    );
    const ids = [...new Set(held.map((i) => i.instrumentId as string))].slice(0, MAX_CODAL_SYMBOLS);
    const events: Array<{
      symbol: string;
      instrumentId: string;
      kind: CodalEventKind;
      kindFa: string;
      titleFa: string;
      publishedAtFa: string;
      tracingNo: number;
      url: string;
    }> = [];
    const errors: string[] = [];
    for (let i = 0; i < ids.length; i += CODAL_CONCURRENCY) {
      await Promise.all(
        ids.slice(i, i + CODAL_CONCURRENCY).map(async (id) => {
          try {
            const data = await this.codal.getNotices(id);
            if (!data?.supported) return;
            if (data.errorFa && !data.items.length) errors.push(`${data.symbol}: ${data.errorFa}`);
            for (const item of data.items) {
              const kind = codalKind(item.titleFa);
              if (!kind) continue;
              events.push({
                symbol: data.symbol,
                instrumentId: id,
                kind,
                kindFa: CODAL_KIND_FA[kind],
                titleFa: item.titleFa,
                publishedAtFa: item.publishedAtFa,
                tracingNo: item.tracingNo,
                url: item.url,
              });
            }
          } catch (e) {
            this.logger.warn(`کدال سبد ${portfolioId}: ${(e as Error).message.slice(0, 200)}`);
          }
        }),
      );
    }
    events.sort((a, b) => b.tracingNo - a.tracingNo);
    return { symbols: ids.length, events: events.slice(0, 40), errors: errors.slice(0, 5) };
  }
}
