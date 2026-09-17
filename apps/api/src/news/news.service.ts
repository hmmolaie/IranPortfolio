import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';
import { daysAgoDateKey, tehranDateFa, tehranDateKey, tehranHour } from './tehran-date';
import { fetchIranEconomyXFeed } from './news-x-fetch';

type NewsLlmItem = {
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string;
  impactDirection?: string;
  relevanceScore?: number;
  sectorsFa?: string;
  xSourceHintFa?: string;
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
      include: { items: { orderBy: { relevanceScore: 'desc' }, take: 5 } },
    });

    const xFeed = await fetchIranEconomyXFeed(24);
    this.logger.log(`فید RSS کمکی X: ${xFeed.posts.length} پست`);

    const system = `${await this.llm.getSystemPrompt(ownerId, 'economic_news_refresh')}

ابزار جستجوی زندهٔ X (x_search) در این درخواست فعال است. اگر rssPostsOptional خالی بود حتماً خودت در X جستجو کن و لیست خالی برنگردان.`;
    const userPrompt = JSON.stringify(
      {
        todayTehran: newsDateKey,
        todayLabelFa: tehranDateFa(),
        source: 'x_live_search_primary',
        rssPostsOptional: xFeed.posts,
        rssNoteFa: xFeed.sourceNoteFa,
        forbid: [
          'قیمت دلار/طلا/سهام از دیتابیس',
          'macroSnapshot',
          'bitpin',
          'TSETMC lastPrice',
        ],
        recentHeadlinesToAvoidRepeat: recentBatches.map((b) => ({
          date: b.newsDateKey,
          topItems: b.items.map((i) => i.titleFa),
        })),
        instruction:
          'با ابزار جستجوی زندهٔ شبکهٔ X همین امروز اقتصاد ایران را بخوان. اگر rssPostsOptional خالی است خودت در X جستجو کن و خبر بساز. قیمت ذخیره‌شده در دیتابیس را نخوان. هر آیتم xSourceHintFa داشته باشد. تکراری نسبت به recentHeadlinesToAvoidRepeat نده. فقط JSON.',
      },
      null,
      2,
    );

    let out: NewsLlmOut;
    try {
      out = await this.llm.chatJson<NewsLlmOut>(
        'economic_news_refresh',
        system,
        userPrompt,
        ownerId,
        {
          liveSearch: {
            x: true,
            web: false,
            fromDate: daysAgoDateKey(2),
            toDate: newsDateKey,
          },
        },
      );
    } catch (e) {
      out = {
        analysisSummaryFa: `خواندن فضای X ناموفق بود. (${(e as Error).message.slice(0, 180)})`,
        sourceNoteFa: xFeed.sourceNoteFa,
        items: [],
      };
    }

    const items = (Array.isArray(out.items) ? out.items : []).filter((i) => this.isXBackedItem(i));
    if (!out.sourceNoteFa?.trim()) {
      out.sourceNoteFa = xFeed.sourceNoteFa;
    }
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
          summaryFa: out.analysisSummaryFa ?? null,
          sourceNoteFa: out.sourceNoteFa ?? null,
        },
      });
      await this.createItems(existing.id, ownerId, items);
      return this.prisma.economicNewsBatch.findUnique({
        where: { id: existing.id },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    }

    const batch = await this.prisma.economicNewsBatch.create({
      data: {
        userId: ownerId,
        newsDateKey,
        summaryFa: out.analysisSummaryFa ?? null,
        sourceNoteFa: out.sourceNoteFa ?? null,
      },
    });
    await this.createItems(batch.id, ownerId, items);
    return this.prisma.economicNewsBatch.findUnique({
      where: { id: batch.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
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
      orderBy: [{ relevanceScore: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: { batch: { select: { newsDateKey: true, summaryFa: true } } },
    });
  }

  private isXBackedItem(item: NewsLlmItem): boolean {
    const title = (item.titleFa ?? '').trim();
    const summary = (item.summaryFa ?? '').trim();
    const hint = (item.xSourceHintFa ?? '').trim();
    if (!title && !summary) return false;
    const blob = `${title} ${summary} ${item.marketImpactFa ?? ''}`;
    if (/macroSnapshot|bitpin|TSETMC|lastPrice|از دیتابیس/i.test(blob)) return false;
    if (
      /^(قیمت (دلار|طلا|سکه|بورس)|دلار امروز|انس طلا)/.test(title) &&
      hint &&
      !/[@#]|x\.com|شبکهٔ X/i.test(hint)
    ) {
      return false;
    }
    if (!hint) item.xSourceHintFa = 'شبکهٔ X (جستجوی زنده)';
    return true;
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
        isRetailActionable: Boolean(item.isRetailActionable) || this.normalizeCategory(item.category, item.isRetailActionable) === 'opportunity',
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
    const allowed = ['ipo', 'auto_sale', 'coin_auction', 'sukuk', 'housing', 'fund', 'deposit', 'other'];
    if (allowed.includes(k)) return k;
    if (/عرضه.?اولیه|ipo/.test(k)) return 'ipo';
    if (/خودرو/.test(k)) return 'auto_sale';
    if (/سکه|حراج/.test(k)) return 'coin_auction';
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
