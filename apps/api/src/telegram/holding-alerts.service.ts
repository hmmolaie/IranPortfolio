import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateKey } from '../news/tehran-date';
import { detectQueue } from '../market/option-board';
import { fundMoveTally, symbolKey } from '../portfolios/stock-signals';
import { TelegramService } from './telegram.service';

/** افت روزانه‌ای که هشدار می‌دهد (درصد) */
const DAILY_DROP_PCT = 5;
/** فاصله از میانگین خرید که هشدار می‌دهد (درصد) */
const BELOW_COST_PCT = 15;
/** فروش دست‌کم این تعداد صندوق در آخرین گزارش ماهانه */
const FUND_SELLERS = 2;
const MAX_LINES_PER_USER = 12;

/**
 * هشدار تلگرامی دارایی‌های سبد بعد از به‌روزرسانی شبانهٔ بورس، برای هر روز معاملاتی یک‌بار:
 * صف فروش، افت روزانه، فاصلهٔ زیاد از میانگین خرید، فروش صندوق‌های برتر و اطلاعیهٔ تازهٔ کدال.
 * فقط برای کاربرانی که ربات را وصل کرده و بخش سبد پیام تلگرام را روشن دارند. بدون مدل.
 */
@Injectable()
export class HoldingAlertsService {
  private readonly logger = new Logger(HoldingAlertsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('*/30 22-23 * * *', { timeZone: 'Asia/Tehran', name: 'holding-alerts' })
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      this.logger.warn(`هشدار دارایی‌ها: ${(e as Error).message.slice(0, 300)}`);
    } finally {
      this.running = false;
    }
  }

  private async run() {
    const latest = await this.prisma.priceBar.findFirst({
      where: { instrument: { assetType: AssetType.STOCK } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (!latest) return;
    const tradeKey = latest.tradeDate.toISOString().slice(0, 10);
    // فقط وقتی میلهٔ امروز ذخیره شده؛ روز تعطیل یا اینجست جاافتاده هشدار ندارد
    if (tradeKey !== tehranDateKey()) return;

    const profiles = await this.prisma.userProfile.findMany({
      where: { telegramChatId: { not: null }, telegramPortfolioEnabled: true, user: { isActive: true } },
      select: { userId: true, telegramChatId: true },
    });
    if (!profiles.length) return;
    const sent = await this.prisma.holdingAlertLog.findMany({
      where: { tradeDateKey: tradeKey, userId: { in: profiles.map((p) => p.userId) } },
      select: { userId: true },
    });
    const done = new Set(sent.map((row) => row.userId));
    const pending = profiles.filter((p) => !done.has(p.userId));
    if (!pending.length) return;

    const tally = await fundMoveTally(this.prisma).catch(() => null);
    for (const profile of pending) {
      const last = await this.prisma.holdingAlertLog.findFirst({
        where: { userId: profile.userId },
        orderBy: { createdAt: 'desc' },
        select: { codalTracingNo: true },
      });
      const { lines, codalTracingNo } = await this.linesFor(
        profile.userId,
        latest.tradeDate,
        tally,
        last?.codalTracingNo ?? null,
      );
      if (lines.length) {
        try {
          await this.telegram.sendText(
            profile.telegramChatId!,
            ['هشدار دارایی‌های سبد شما (سبدیار)', '', ...lines.slice(0, MAX_LINES_PER_USER), '', 'این پیام اطلاع‌رسانی است و توصیهٔ معامله نیست.'].join('\n'),
          );
        } catch (e) {
          this.logger.warn(`ارسال هشدار به ${profile.userId}: ${(e as Error).message.slice(0, 200)}`);
          continue;
        }
      }
      await this.prisma.holdingAlertLog.create({
        data: { userId: profile.userId, tradeDateKey: tradeKey, lineCount: lines.length, codalTracingNo },
      });
    }
  }

  private async linesFor(
    userId: string,
    tradeDate: Date,
    tally: Map<string, { sellers: number }> | null,
    /** بزرگ‌ترین شمارهٔ پیگیری کدال که قبلاً برای این کاربر دیده شده؛ null یعنی اولین نوبت */
    lastTracingNo: number | null,
  ): Promise<{ lines: string[]; codalTracingNo: number | null }> {
    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      select: {
        name: true,
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { items: { select: { symbol: true, assetType: true, instrumentId: true, avgBuyPrice: true, unitPrice: true } } },
        },
      },
    });
    const held = new Map<string, { symbol: string; avg: number | null; portfolio: string }>();
    for (const p of portfolios) {
      for (const item of p.snapshots[0]?.items ?? []) {
        if (item.assetType !== AssetType.STOCK || !item.instrumentId || held.has(item.instrumentId)) continue;
        const avg = item.avgBuyPrice ?? item.unitPrice;
        held.set(item.instrumentId, { symbol: item.symbol, avg: avg && avg > 0 ? avg : null, portfolio: p.name });
      }
    }
    if (!held.size) return { lines: [], codalTracingNo: lastTracingNo };
    const bars = await this.prisma.priceBar.findMany({
      where: { instrumentId: { in: [...held.keys()] }, tradeDate: { lte: tradeDate, gte: new Date(tradeDate.getTime() - 15 * 86_400_000) } },
      orderBy: [{ instrumentId: 'asc' }, { tradeDate: 'desc' }],
      select: { instrumentId: true, tradeDate: true, lastPrice: true, closePrice: true, raw: true },
    });
    const byId = new Map<string, typeof bars>();
    for (const bar of bars) {
      const list = byId.get(bar.instrumentId) ?? [];
      if (list.length < 2) list.push(bar);
      byId.set(bar.instrumentId, list);
    }
    const lines: string[] = [];
    const fa = (n: number) => n.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
    for (const [id, h] of held) {
      const [today, prev] = byId.get(id) ?? [];
      if (!today || today.tradeDate.getTime() !== tradeDate.getTime()) continue;
      const price = today.lastPrice ?? today.closePrice;
      if (!(price && price > 0)) continue;
      const notes: string[] = [];
      if (detectQueue(today.raw, price) === 'sell') notes.push('صف فروش');
      const prevPrice = prev ? prev.closePrice ?? prev.lastPrice : null;
      if (prevPrice && prevPrice > 0) {
        const change = ((price - prevPrice) / prevPrice) * 100;
        if (change <= -DAILY_DROP_PCT) notes.push(`افت روزانه ${fa(Math.abs(change))}٪`);
      }
      if (h.avg) {
        const gap = ((price - h.avg) / h.avg) * 100;
        if (gap <= -BELOW_COST_PCT) notes.push(`${fa(Math.abs(gap))}٪ زیر میانگین خرید`);
      }
      const sellers = tally?.get(symbolKey(h.symbol))?.sellers ?? 0;
      if (sellers >= FUND_SELLERS) notes.push(`فروش ${sellers.toLocaleString('fa-IR')} صندوق برتر در آخرین گزارش ماهانه`);
      if (notes.length) lines.push(`• ${h.symbol} (${h.portfolio}): ${notes.join('، ')}`);
    }
    // اطلاعیه‌های کدال هر روز دوباره ذخیره می‌شوند؛ تازگی با شمارهٔ پیگیری سنجیده می‌شود نه زمان ذخیره
    const notices = await this.prisma.codalNotice.findMany({
      where: { symbol: { in: [...held.values()].map((h) => h.symbol) } },
      orderBy: { tracingNo: 'desc' },
      take: 30,
      select: { symbol: true, titleFa: true, url: true, tracingNo: true },
    });
    const maxSeen = notices.reduce((m, n) => Math.max(m, n.tracingNo), lastTracingNo ?? 0);
    if (lastTracingNo != null) {
      const seen = new Set<number>();
      for (const n of notices) {
        if (n.tracingNo <= lastTracingNo || seen.has(n.tracingNo)) continue;
        seen.add(n.tracingNo);
        if (seen.size > 5) break;
        lines.push(`• کدال ${n.symbol}: ${n.titleFa}\n${n.url}`);
      }
    }
    return { lines, codalTracingNo: maxSeen > 0 ? maxSeen : lastTracingNo };
  }
}
