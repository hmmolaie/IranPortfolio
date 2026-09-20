import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { SOCIAL_NETWORK_LABEL_FA, replaceSocialNetworkBrandFa } from '../llm/social-source-wording';
import { UsersService } from '../users/users.service';
import { daysAgoDateKey, tehranDateFa, tehranDateKey, tehranHour } from './tehran-date';

const MAX_MACRO_ITEMS = 7;
const MAX_OPPORTUNITY_ITEMS = 3;

type NewsLlmItem = {
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string;
  impactDirection?: string;
  relevanceScore?: number;
  sectorsFa?: string;
  xSourceHintFa?: string;
  accountNameFa?: string;
  originalLanguage?: string;
  category?: string;
  opportunityKind?: string;
  participateHowFa?: string;
  deadlineFa?: string;
  officialSourceFa?: string;
  isRetailActionable?: boolean;
};

type NewsLlmOut = {
  analysisSummaryFa: string;
  sourceNoteFa?: string;
  items: NewsLlmItem[];
};

@Injectable()
export class NewsService implements OnModuleInit {
  private readonly logger = new Logger(NewsService.name);
  private refreshInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'production') return;
    setTimeout(() => {
      void this.catchUpAfterRestart();
    }, 20_000);
  }

  /** هر روز ۸:۰۰ صبح به وقت ایران */
  @Cron('0 0 8 * * *', { timeZone: 'Asia/Tehran', name: 'economic-news-0800' })
  async scheduledRefresh() {
    this.logger.log('بروزرسانی زمان‌بندی‌شده اخبار اقتصادی (۸ صبح ایران)');
    await this.runScheduledRefresh({ overwriteExisting: true });
  }

  /** اگر ۸ صبح از دست رفت یا مدل خالی برگرداند، ۹ و ۱۰ صبح دوباره تلاش می‌کند */
  @Cron('0 0 9,10 * * *', { timeZone: 'Asia/Tehran', name: 'economic-news-retry' })
  async scheduledRetry() {
    await this.runScheduledRefresh({ overwriteExisting: false });
  }

  private async catchUpAfterRestart() {
    if (tehranHour() >= 8) {
      this.logger.log('پس از راه‌اندازی: اگر اخبار امروز خالی باشد جمع می‌شود');
      await this.runScheduledRefresh({ overwriteExisting: false });
    }
  }

  private async runScheduledRefresh(opts: { overwriteExisting: boolean }) {
    if (this.refreshInFlight) {
      this.logger.log('کرون اخبار در حال اجراست؛ درخواست هم‌زمان رد شد');
      return;
    }
    this.refreshInFlight = true;
    try {
      const adminId = await this.users.getAdminUserId();
      if (!adminId) {
        this.logger.warn('کاربر admin یافت نشد؛ کرون اخبار رد شد');
        return;
      }
      const newsDateKey = tehranDateKey();
      if (!opts.overwriteExisting) {
        const existing = await this.prisma.economicNewsBatch.findUnique({
          where: { userId_newsDateKey: { userId: adminId, newsDateKey } },
          include: { _count: { select: { items: true } } },
        });
        if (existing && existing._count.items > 0) {
          return;
        }
        this.logger.log(`تلاش مجدد اخبار ${newsDateKey} (ساعت تهران ${tehranHour()})`);
      }
      const batch = await this.refresh(adminId, { persistEmpty: false });
      const n = batch?.items?.length ?? 0;
      this.logger.log(`کرون اخبار ${newsDateKey}: ${n} خبر ذخیره شد`);
    } catch (e) {
      this.logger.error(`کرون اخبار ناموفق: ${(e as Error).message}`);
    } finally {
      this.refreshInFlight = false;
    }
  }

  /** اخبار مشترک پلتفرم (ذخیره‌شده توسط admin) */
  private async platformOwnerId(fallbackUserId: string) {
    return (await this.users.getAdminUserId()) ?? fallbackUserId;
  }

  async list(userId: string, days = 14) {
    const ownerId = await this.platformOwnerId(userId);
    const since = daysAgoDateKey(days);
    const batches = await this.prisma.economicNewsBatch.findMany({
      where: { userId: ownerId, newsDateKey: { gte: since } },
      orderBy: { newsDateKey: 'desc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return {
      todayKey: tehranDateKey(),
      todayLabelFa: tehranDateFa(),
      batches,
    };
  }

  async refresh(userId: string, opts?: { persistEmpty?: boolean }) {
    const ownerId = await this.platformOwnerId(userId);
    const newsDateKey = tehranDateKey();
    const persistEmpty = opts?.persistEmpty !== false;
    const includeItems = { items: { orderBy: { sortOrder: 'asc' as const } } };
    const recentBatches = await this.prisma.economicNewsBatch.findMany({
      where: { userId: ownerId },
      orderBy: { newsDateKey: 'desc' },
      take: 3,
      include: { items: { orderBy: { relevanceScore: 'desc' }, take: 8 } },
    });
    const recentHeadlines = recentBatches.map((b) => ({
      date: b.newsDateKey,
      topItems: b.items.map((i) => i.titleFa),
    }));

    const [newsOut, oppOut] = await Promise.all([
      this.runGrokSearch(ownerId, 'economic_news_refresh', {
        todayTehran: newsDateKey,
        todayLabelFa: tehranDateFa(),
        maxItems: MAX_MACRO_ITEMS,
        recentHeadlinesToAvoidRepeat: recentHeadlines,
        instruction:
          'در کل فضای شبکه اجتماعی به هر زبانی بگرد. حداکثر ۷ مطلب از معتبرترین حساب‌هایی که چیزی نوشته‌اند که ممکن است روی اقتصاد ایران اثر بگذارد. همه را فارسی بنویس. تکراری نسبت به recentHeadlinesToAvoidRepeat نده. در متن فارسی خروجی نام X یا توییتر ننویس؛ فقط بگو شبکه اجتماعی.',
      }),
      this.runGrokSearch(ownerId, 'economic_opportunity_refresh', {
        todayTehran: newsDateKey,
        todayLabelFa: tehranDateFa(),
        maxItems: MAX_OPPORTUNITY_ITEMS,
        recentHeadlinesToAvoidRepeat: recentHeadlines,
        instruction:
          'در کل فضای شبکه اجتماعی به هر زبانی بگرد. حداکثر ۳ مطلب از معتبرترین حساب‌ها درباره عرضه اولیه، ثبت‌نام خودرو، حراج سکه یا ارز، آربیتراژ، یا بازار مستعد رشد. همه را فارسی بنویس. در متن فارسی خروجی نام X یا توییتر ننویس؛ فقط بگو شبکه اجتماعی.',
      }),
    ]);

    const macros = this.takeValid(newsOut.items, MAX_MACRO_ITEMS).map((item) => ({
      ...item,
      category: 'macro' as const,
      isRetailActionable: false,
    }));
    const opportunities = this.takeValid(oppOut.items, MAX_OPPORTUNITY_ITEMS).map((item) => ({
      ...item,
      category: 'opportunity' as const,
      isRetailActionable: item.isRetailActionable !== false,
    }));
    const items = [...macros, ...opportunities];
    const analysisSummaryFa = [newsOut.analysisSummaryFa, oppOut.analysisSummaryFa]
      .map((s) => replaceSocialNetworkBrandFa((s ?? '').trim()))
      .filter(Boolean)
      .join('\n\n');
    const sourceNoteFa =
      [newsOut.sourceNoteFa, oppOut.sourceNoteFa]
        .map((s) => replaceSocialNetworkBrandFa((s ?? '').trim()))
        .filter(Boolean)
        .join(' · ') || null;

    const existing = await this.prisma.economicNewsBatch.findUnique({
      where: { userId_newsDateKey: { userId: ownerId, newsDateKey } },
    });

    if (!items.length && !persistEmpty) {
      this.logger.warn(`مدل برای ${newsDateKey} خبری برنگرداند؛ ذخیره نشد`);
      return existing
        ? this.prisma.economicNewsBatch.findUnique({
            where: { id: existing.id },
            include: includeItems,
          })
        : null;
    }

    if (existing) {
      await this.prisma.economicNewsItem.deleteMany({ where: { batchId: existing.id } });
      await this.prisma.economicNewsBatch.update({
        where: { id: existing.id },
        data: {
          summaryFa: analysisSummaryFa || null,
          sourceNoteFa,
        },
      });
      await this.createItems(existing.id, ownerId, items);
      return this.prisma.economicNewsBatch.findUnique({
        where: { id: existing.id },
        include: includeItems,
      });
    }

    const batch = await this.prisma.economicNewsBatch.create({
      data: {
        userId: ownerId,
        newsDateKey,
        summaryFa: analysisSummaryFa || null,
        sourceNoteFa,
      },
    });
    await this.createItems(batch.id, ownerId, items);
    return this.prisma.economicNewsBatch.findUnique({
      where: { id: batch.id },
      include: includeItems,
    });
  }

  /** اخبار اخیر برای پیشنهاد سبد — از مخزن مشترک admin (پیش‌فرض حدود یک ماه) */
  async getForPortfolioContext(userId: string, limit = 40, days = 30) {
    const ownerId = await this.platformOwnerId(userId);
    const since = daysAgoDateKey(days);
    return this.prisma.economicNewsItem.findMany({
      where: {
        userId: ownerId,
        batch: { newsDateKey: { gte: since } },
      },
      orderBy: [{ createdAt: 'desc' }, { relevanceScore: 'desc' }],
      take: limit,
      include: { batch: { select: { newsDateKey: true, summaryFa: true } } },
    });
  }

  private async runGrokSearch(
    ownerId: string,
    purpose: 'economic_news_refresh' | 'economic_opportunity_refresh',
    payload: Record<string, unknown>,
  ): Promise<NewsLlmOut> {
    const system = await this.llm.getSystemPrompt(ownerId, purpose);
    const newsDateKey = tehranDateKey();
    try {
      const out = await this.llm.chatJson<NewsLlmOut>(
        purpose,
        system,
        JSON.stringify(payload, null, 2),
        ownerId,
        {
          preferGrok: true,
          liveSearch: {
            x: true,
            web: false,
            fromDate: daysAgoDateKey(3),
            toDate: newsDateKey,
          },
        },
      );
      return {
        analysisSummaryFa: (out.analysisSummaryFa ?? '').trim(),
        sourceNoteFa: (out.sourceNoteFa ?? '').trim() || undefined,
        items: Array.isArray(out.items) ? out.items : [],
      };
    } catch (e) {
      this.logger.warn(`${purpose} ناموفق: ${(e as Error).message.slice(0, 180)}`);
      return {
        analysisSummaryFa: '',
        items: [],
      };
    }
  }

  private takeValid(raw: NewsLlmItem[], max: number): NewsLlmItem[] {
    const out: NewsLlmItem[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (out.length >= max) break;
      const cleaned = this.cleanItem(item);
      if (!cleaned) continue;
      const key = cleaned.titleFa.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  private cleanItem(item: NewsLlmItem): NewsLlmItem | null {
    const titleFa = replaceSocialNetworkBrandFa((item.titleFa ?? '').replace(/\s+/g, ' ').trim()).slice(0, 220);
    const summaryFa = replaceSocialNetworkBrandFa((item.summaryFa ?? '').replace(/\s+/g, ' ').trim()).slice(
      0,
      2000,
    );
    if (!titleFa && !summaryFa) return null;
    const blob = `${titleFa} ${summaryFa} ${item.marketImpactFa ?? ''}`;
    if (/macroSnapshot|bitpin|TSETMC/i.test(blob)) return null;
    const hint = replaceSocialNetworkBrandFa(
      [item.xSourceHintFa, item.accountNameFa]
        .map((s) => (s ?? '').trim())
        .filter(Boolean)
        .join(' · '),
    );
    return {
      ...item,
      titleFa: titleFa || summaryFa.slice(0, 80),
      summaryFa: summaryFa || titleFa,
      marketImpactFa: item.marketImpactFa
        ? replaceSocialNetworkBrandFa(item.marketImpactFa)
        : item.marketImpactFa,
      participateHowFa: item.participateHowFa
        ? replaceSocialNetworkBrandFa(item.participateHowFa)
        : item.participateHowFa,
      xSourceHintFa: hint || item.officialSourceFa?.trim() || SOCIAL_NETWORK_LABEL_FA,
    };
  }

  private async createItems(batchId: string, userId: string, items: NewsLlmItem[]) {
    if (!items.length) return;
    await this.prisma.economicNewsItem.createMany({
      data: items.map((item, idx) => ({
        batchId,
        userId,
        titleFa: item.titleFa?.trim() || `خبر ${idx + 1}`,
        summaryFa: item.summaryFa?.trim() || '',
        marketImpactFa: item.marketImpactFa?.trim() || null,
        impactDirection: this.normalizeDirection(item.impactDirection),
        relevanceScore: this.clampRelevance(item.relevanceScore),
        sectorsFa: item.sectorsFa?.trim() || null,
        xSourceHintFa: item.xSourceHintFa?.trim() || null,
        category: this.normalizeCategory(item.category, item.isRetailActionable),
        opportunityKind: this.normalizeOpportunityKind(item.opportunityKind),
        participateHowFa: item.participateHowFa?.trim() || null,
        deadlineFa: item.deadlineFa?.trim() || null,
        officialSourceFa: item.officialSourceFa?.trim() || null,
        isRetailActionable:
          Boolean(item.isRetailActionable) ||
          this.normalizeCategory(item.category, item.isRetailActionable) === 'opportunity',
        sortOrder: idx,
      })),
    });
  }

  private normalizeDirection(dir?: string): string | null {
    if (!dir) return null;
    const d = dir.toLowerCase().trim();
    if (['bullish', 'bearish', 'neutral', 'mixed'].includes(d)) return d;
    if (/مثبت|صعود/.test(dir)) return 'bullish';
    if (/منفی|نزول/.test(dir)) return 'bearish';
    return 'neutral';
  }

  private normalizeCategory(cat?: string, actionable?: boolean): string | null {
    const c = (cat ?? '').toLowerCase().trim();
    if (c === 'opportunity' || c === 'فرصت') return 'opportunity';
    if (c === 'macro' || c === 'کلان') return 'macro';
    if (actionable) return 'opportunity';
    return 'macro';
  }

  private normalizeOpportunityKind(kind?: string): string | null {
    if (!kind) return null;
    const k = kind.toLowerCase().trim();
    const allowed = [
      'ipo',
      'auto_sale',
      'coin_auction',
      'fx_auction',
      'arbitrage',
      'growth',
      'sukuk',
      'housing',
      'fund',
      'deposit',
      'other',
    ];
    if (allowed.includes(k)) return k;
    if (/عرضه.?اولیه|ipo/.test(k)) return 'ipo';
    if (/خودرو/.test(k)) return 'auto_sale';
    if (/سکه|حراج سکه/.test(k)) return 'coin_auction';
    if (/حراج.?ارز|حواله/.test(k)) return 'fx_auction';
    if (/آربیتراژ|arbitrage/.test(k)) return 'arbitrage';
    if (/رشد|مستعد/.test(k)) return 'growth';
    if (/صکوک|اوراق/.test(k)) return 'sukuk';
    if (/مسکن/.test(k)) return 'housing';
    if (/صندوق|etf/.test(k)) return 'fund';
    if (/سپرد|گواهی/.test(k)) return 'deposit';
    return 'other';
  }

  private clampRelevance(n?: number): number | null {
    const v = Number(n);
    if (Number.isNaN(v)) return null;
    return Math.min(10, Math.max(1, Math.round(v * 10) / 10));
  }
}
