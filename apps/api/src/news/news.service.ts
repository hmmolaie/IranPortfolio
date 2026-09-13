import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';
import { daysAgoDateKey, tehranDateFa, tehranDateKey } from './tehran-date';

type NewsLlmItem = {
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string;
  impactDirection?: string;
  relevanceScore?: number;
  sectorsFa?: string;
  xSourceHintFa?: string;
};

type NewsLlmOut = {
  analysisSummaryFa: string;
  sourceNoteFa?: string;
  items: NewsLlmItem[];
};

@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

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

  async refresh(userId: string) {
    const ownerId = await this.platformOwnerId(userId);
    const newsDateKey = tehranDateKey();
    const macro = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const recentBatches = await this.prisma.economicNewsBatch.findMany({
      where: { userId: ownerId },
      orderBy: { newsDateKey: 'desc' },
      take: 3,
      include: { items: { orderBy: { relevanceScore: 'desc' }, take: 5 } },
    });

    const system = await this.llm.getSystemPrompt(ownerId, 'economic_news_refresh');
    const userPrompt = JSON.stringify(
      {
        todayTehran: newsDateKey,
        todayLabelFa: tehranDateFa(),
        macroContext: macro,
        recentHeadlines: recentBatches.map((b) => ({
          date: b.newsDateKey,
          summary: b.summaryFa,
          topItems: b.items.map((i) => i.titleFa),
        })),
        instruction:
          'با دسترسی خود به X، اخبار و بحث‌های اقتصادی امروز ایران را مرور کن و اخبار با اثر محتمل فردا روی بورس تهران را لیست کن. فقط نتیجهٔ JSON را برگردان.',
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
      );
    } catch (e) {
      out = {
        analysisSummaryFa: `تحلیل خودکار در دسترس نبود. (${(e as Error).message.slice(0, 180)})`,
        sourceNoteFa: 'LLM',
        items: [],
      };
    }

    const items = Array.isArray(out.items) ? out.items : [];

    const existing = await this.prisma.economicNewsBatch.findUnique({
      where: { userId_newsDateKey: { userId: ownerId, newsDateKey } },
    });
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

  private clampRelevance(n?: number): number | null {
    const v = Number(n);
    if (Number.isNaN(v)) return null;
    return Math.min(10, Math.max(1, Math.round(v * 10) / 10));
  }
}
