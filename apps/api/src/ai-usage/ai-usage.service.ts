import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { daysAgoDateKey, tehranDateKey } from '../news/tehran-date';
import {
  AiUsageHit,
  QUOTA_PURPOSES,
  aiUsageStore,
  sectionKey,
  sectionLabel,
  sectionOptions,
} from './ai-usage.sections';

export class AiQuotaExceededException extends BadRequestException {
  constructor() {
    super('سهمیه هوش مصنوعی شما تمام شده است. باید اکانت خود را شارژ کنید.');
  }
}

export type TokenUse = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
};

const ZERO_RATES = { promptRialPer1k: 0, completionRialPer1k: 0, defaultQuotaTokens: 0, resetAt: null as Date | null };

@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(userId: string | undefined, purpose: string) {
    if (!userId || !QUOTA_PURPOSES.has(purpose)) return;
    const limit = await this.limitFor(userId);
    if (limit <= 0) return;
    const used = await this.usedTokens(userId);
    if (used >= limit) throw new AiQuotaExceededException();
  }

  async record(
    userId: string | undefined,
    purpose: string,
    model: string | undefined,
    use: TokenUse,
    exchange?: { prompt?: string; response?: string },
  ): Promise<AiUsageHit> {
    const rates = await this.rates();
    const costRial = Math.max(
      0,
      Math.round(
        (use.promptTokens / 1000) * rates.promptRialPer1k +
          (use.completionTokens / 1000) * rates.completionRialPer1k,
      ),
    );
    const section = sectionKey(purpose);
    const hit: AiUsageHit = {
      purpose,
      sectionFa: sectionLabel(section),
      promptTokens: use.promptTokens,
      completionTokens: use.completionTokens,
      totalTokens: use.totalTokens,
      costRial,
      estimated: use.estimated,
    };
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          userId: userId ?? null,
          purpose,
          section,
          model: model ?? null,
          promptTokens: use.promptTokens,
          completionTokens: use.completionTokens,
          totalTokens: use.totalTokens,
          costRial,
          estimated: use.estimated,
          prompt: exchange?.prompt ?? '',
          response: exchange?.response ?? '',
          dateKey: tehranDateKey(),
        },
      });
    } catch {
      /* ثبت مصرف نباید پاسخ مدل را خراب کند */
    }
    aiUsageStore.getStore()?.hits.push(hit);
    return hit;
  }

  async me(userId: string) {
    const [limit, sums] = await Promise.all([this.limitFor(userId), this.sumsForUser(userId)]);
    return {
      limitTokens: limit,
      unlimited: limit <= 0,
      ...sums,
    };
  }

  async adminReport() {
    const since = daysAgoDateKey(13);
    const config = await this.rates();
    const counted = this.countedFilter(config.resetAt);
    const [users, logs, daily] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { email: 'asc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          aiQuota: { select: { limitTokens: true } },
        },
      }),
      this.prisma.aiUsageLog.groupBy({
        where: counted,
        by: ['userId', 'section'],
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costRial: true,
        },
        _count: { _all: true },
      }),
      this.prisma.aiUsageLog.findMany({
        where: { ...counted, dateKey: { gte: since } },
        select: { section: true, dateKey: true, totalTokens: true, costRial: true },
      }),
    ]);

    const userTotals = new Map<
      string,
      { promptTokens: number; completionTokens: number; totalTokens: number; costRial: number; calls: number }
    >();
    const sectionTotals = new Map<
      string,
      { promptTokens: number; completionTokens: number; totalTokens: number; costRial: number; calls: number }
    >();
    for (const row of logs) {
      const add = {
        promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0,
        totalTokens: row._sum.totalTokens ?? 0,
        costRial: row._sum.costRial ?? 0,
        calls: row._count._all,
      };
      if (row.userId) {
        const prev = userTotals.get(row.userId) ?? emptySums();
        userTotals.set(row.userId, mergeSums(prev, add));
      }
      const sec = sectionTotals.get(row.section) ?? emptySums();
      sectionTotals.set(row.section, mergeSums(sec, add));
    }

    const dateKeys = lastDateKeys(14);
    const dailyMap = new Map<string, Map<string, { totalTokens: number; costRial: number }>>();
    for (const row of daily) {
      const byDay = dailyMap.get(row.section) ?? new Map();
      const prev = byDay.get(row.dateKey) ?? { totalTokens: 0, costRial: 0 };
      byDay.set(row.dateKey, {
        totalTokens: prev.totalTokens + row.totalTokens,
        costRial: prev.costRial + row.costRial,
      });
      dailyMap.set(row.section, byDay);
    }

    const sections = [...sectionTotals.entries()]
      .map(([section, sums]) => ({
        section,
        labelFa: sectionLabel(section),
        ...sums,
        daily: dateKeys.map((dateKey) => ({
          dateKey,
          totalTokens: dailyMap.get(section)?.get(dateKey)?.totalTokens ?? 0,
          costRial: dailyMap.get(section)?.get(dateKey)?.costRial ?? 0,
        })),
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      config: {
        promptRialPer1k: config.promptRialPer1k,
        completionRialPer1k: config.completionRialPer1k,
        defaultQuotaTokens: config.defaultQuotaTokens,
      },
      dateKeys,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        limitTokens: user.aiQuota?.limitTokens ?? config.defaultQuotaTokens,
        hasOwnQuota: Boolean(user.aiQuota),
        ...(userTotals.get(user.id) ?? emptySums()),
      })),
      sections,
    };
  }

  async saveConfig(input: {
    promptRialPer1k: number;
    completionRialPer1k: number;
    defaultQuotaTokens: number;
  }) {
    const data = {
      promptRialPer1k: clampNum(input.promptRialPer1k),
      completionRialPer1k: clampNum(input.completionRialPer1k),
      defaultQuotaTokens: clampInt(input.defaultQuotaTokens),
    };
    await this.prisma.aiUsageConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return data;
  }

  async saveUserQuota(userId: string, limitTokens: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException('کاربر پیدا نشد.');
    const limit = clampInt(limitTokens);
    await this.prisma.aiUserQuota.upsert({
      where: { userId },
      create: { userId, limitTokens: limit },
      update: { limitTokens: limit },
    });
    return { userId, limitTokens: limit };
  }

  async reset() {
    const resetAt = new Date();
    await this.prisma.aiUsageConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', resetAt },
      update: { resetAt },
    });
    return { resetAt };
  }

  async history(query: { userId?: string; section?: string; cursor?: string }) {
    const take = 25;
    const userId = query.userId?.trim() || undefined;
    const section = query.section?.trim() || undefined;
    const cursor = query.cursor?.trim() || undefined;
    const where = {
      ...(userId ? { userId } : {}),
      ...(section ? { section } : {}),
    };
    const rows = await this.prisma.aiUsageLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        purpose: true,
        section: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costRial: true,
        estimated: true,
        createdAt: true,
        prompt: true,
        response: true,
        user: { select: { email: true, name: true } },
      },
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const users = await this.prisma.user.findMany({
      orderBy: { email: 'asc' },
      select: { id: true, email: true, name: true },
    });
    return {
      users,
      sections: sectionOptions(),
      items: page.map((row) => ({
        id: row.id,
        userId: row.userId,
        userLabel: row.user?.name?.trim() || row.user?.email || 'سیستم',
        email: row.user?.email ?? null,
        purpose: row.purpose,
        section: row.section,
        sectionFa: sectionLabel(row.section),
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        costRial: row.costRial,
        estimated: row.estimated,
        createdAt: row.createdAt,
        promptPreview: previewText(row.prompt),
        responsePreview: previewText(row.response),
        promptChars: row.prompt.length,
        responseChars: row.response.length,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async historyItem(id: string) {
    const row = await this.prisma.aiUsageLog.findUnique({
      where: { id },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!row) throw new NotFoundException('این سابقه پیدا نشد.');
    return {
      id: row.id,
      userId: row.userId,
      userLabel: row.user?.name?.trim() || row.user?.email || 'سیستم',
      email: row.user?.email ?? null,
      purpose: row.purpose,
      section: row.section,
      sectionFa: sectionLabel(row.section),
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      costRial: row.costRial,
      estimated: row.estimated,
      createdAt: row.createdAt,
      prompt: row.prompt,
      response: row.response,
    };
  }

  private countedFilter(resetAt: Date | null): { createdAt?: { gt: Date } } {
    return resetAt ? { createdAt: { gt: resetAt } } : {};
  }

  private async rates() {
    const row = await this.prisma.aiUsageConfig.findUnique({ where: { id: 'default' } });
    if (!row) return { ...ZERO_RATES };
    return {
      promptRialPer1k: row.promptRialPer1k,
      completionRialPer1k: row.completionRialPer1k,
      defaultQuotaTokens: row.defaultQuotaTokens,
      resetAt: row.resetAt,
    };
  }

  private async limitFor(userId: string) {
    const [quota, config] = await Promise.all([
      this.prisma.aiUserQuota.findUnique({ where: { userId }, select: { limitTokens: true } }),
      this.rates(),
    ]);
    return quota?.limitTokens ?? config.defaultQuotaTokens;
  }

  private async usedTokens(userId: string) {
    const config = await this.rates();
    const sum = await this.prisma.aiUsageLog.aggregate({
      where: { userId, ...this.countedFilter(config.resetAt) },
      _sum: { totalTokens: true },
    });
    return sum._sum.totalTokens ?? 0;
  }

  private async sumsForUser(userId: string) {
    const config = await this.rates();
    const sum = await this.prisma.aiUsageLog.aggregate({
      where: { userId, ...this.countedFilter(config.resetAt) },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costRial: true,
      },
    });
    return {
      promptTokens: sum._sum.promptTokens ?? 0,
      completionTokens: sum._sum.completionTokens ?? 0,
      totalTokens: sum._sum.totalTokens ?? 0,
      costRial: sum._sum.costRial ?? 0,
    };
  }
}

function previewText(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > 180 ? `${flat.slice(0, 180)}…` : flat;
}

function emptySums() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costRial: 0, calls: 0 };
}

function mergeSums(
  a: ReturnType<typeof emptySums>,
  b: ReturnType<typeof emptySums>,
): ReturnType<typeof emptySums> {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    costRial: a.costRial + b.costRial,
    calls: a.calls + b.calls,
  };
}

function lastDateKeys(days: number): string[] {
  const keys: string[] = [];
  for (let ago = days - 1; ago >= 0; ago -= 1) keys.push(daysAgoDateKey(ago));
  return keys;
}

function clampNum(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 1_000_000_000);
}

function clampInt(value: number): number {
  return Math.round(clampNum(value));
}
