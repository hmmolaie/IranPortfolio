import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { daysAgoDateKey, tehranDateKey } from '../news/tehran-date';
import {
  AiUsageHit,
  PORTFOLIO_AI_PURPOSES,
  QUOTA_PURPOSES,
  aiUsageStore,
  sectionKey,
  sectionLabel,
  sectionOptions,
  SYSTEM_HISTORY_PURPOSES,
} from './ai-usage.sections';
import { UsersService } from '../users/users.service';

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

type UsageSums = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costRial: number;
};

type MeSnapshot = UsageSums & {
  limitTokens: number;
  unlimited: boolean;
};

const USAGE_TEXT_MAX = 80_000;

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);
  private readonly meCache = new Map<string, { at: number; value: MeSnapshot }>();
  private readonly meFlight = new Map<string, Promise<MeSnapshot>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async assertAllowed(userId: string | undefined, purpose: string) {
    if (userId) {
      const access = await this.users.aiAccess(userId);
      if (!access.llm && QUOTA_PURPOSES.has(purpose)) {
        throw new ForbiddenException('استفاده از مدل زبانی برای این حساب خاموش است.');
      }
      if (PORTFOLIO_AI_PURPOSES.has(purpose) && !access.portfolio) {
        throw new ForbiddenException('پیشنهاد سبد با هوش مصنوعی برای این حساب خاموش است.');
      }
    }
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
    exchange?: { prompt?: string; response?: string; ok?: boolean },
  ): Promise<AiUsageHit> {
    const failed = exchange?.ok === false;
    const promptTokens = usageInt(use.promptTokens);
    const completionTokens = usageInt(use.completionTokens);
    const totalTokens = usageInt(use.totalTokens) || promptTokens + completionTokens;
    const rates = await this.rates();
    const costRial = failed
      ? 0
      : Math.max(
          0,
          usageInt(
            (promptTokens / 1000) * rates.promptRialPer1k + (completionTokens / 1000) * rates.completionRialPer1k,
          ),
        );
    const section = sectionKey(purpose);
    const hit: AiUsageHit = {
      purpose,
      sectionFa: sectionLabel(section),
      promptTokens,
      completionTokens,
      totalTokens,
      costRial,
      estimated: use.estimated,
    };
    const data = {
      userId: userId ?? null,
      purpose,
      section,
      model: model ?? null,
      promptTokens,
      completionTokens,
      totalTokens,
      costRial,
      estimated: use.estimated,
      ok: !failed,
      prompt: usageText(exchange?.prompt),
      response: usageText(exchange?.response),
      dateKey: tehranDateKey(),
    };
    try {
      await this.prisma.aiUsageLog.create({ data });
    } catch (e) {
      this.logger.warn(`ثبت سابقهٔ ${purpose} کوتاه شد: ${(e as Error).message.slice(0, 180)}`);
      try {
        await this.prisma.aiUsageLog.create({
          data: {
            ...data,
            prompt: data.prompt.slice(0, 2000),
            response: data.response.slice(0, 2000),
          },
        });
      } catch (again) {
        this.logger.warn(`ثبت سابقهٔ ${purpose} ناموفق ماند: ${(again as Error).message.slice(0, 180)}`);
      }
    }
    if (userId) this.meCache.delete(userId);
    if (!failed) aiUsageStore.getStore()?.hits.push(hit);
    return hit;
  }

  async me(userId: string): Promise<MeSnapshot> {
    const cached = this.meCache.get(userId);
    if (cached && Date.now() - cached.at < 8_000) return cached.value;
    const pending = this.meFlight.get(userId);
    if (pending) return pending;
    const job = this.loadMe(userId)
      .then((value) => {
        this.meCache.set(userId, { at: Date.now(), value });
        return value;
      })
      .catch((err: unknown) => {
        const stale = this.meCache.get(userId);
        if (stale) return stale.value;
        throw err;
      })
      .finally(() => {
        this.meFlight.delete(userId);
      });
    this.meFlight.set(userId, job);
    return job;
  }

  private async loadMe(userId: string): Promise<MeSnapshot> {
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
      this.groupedUsage(config.resetAt),
      this.prisma.aiUsageLog.findMany({
        where: { ...counted, ok: true, dateKey: { gte: since } },
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
        promptTokens: asCount(row.promptTokens),
        completionTokens: asCount(row.completionTokens),
        totalTokens: asCount(row.totalTokens),
        costRial: asCount(row.costRial),
        calls: asCount(row.calls),
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
      ...(section ? { section } : {}),
      ...(userId
        ? { userId, purpose: { notIn: [...SYSTEM_HISTORY_PURPOSES] } }
        : {}),
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
        ok: true,
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
        ...historyActor(row.purpose, row.user),
        purpose: row.purpose,
        section: row.section,
        sectionFa: sectionLabel(row.section),
        model: row.model,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        totalTokens: row.totalTokens,
        costRial: row.costRial,
        estimated: row.estimated,
        ok: row.ok,
        createdAt: row.createdAt,
        promptPreview: previewText(row.prompt),
        responsePreview: previewText(row.response),
        promptChars: row.prompt.length,
        responseChars: row.response.length,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
  }

  async clearHistory() {
    const result = await this.prisma.aiUsageLog.deleteMany();
    this.meCache.clear();
    return { deleted: result.count };
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
      ...historyActor(row.purpose, row.user),
      purpose: row.purpose,
      section: row.section,
      sectionFa: sectionLabel(row.section),
      model: row.model,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      costRial: row.costRial,
      estimated: row.estimated,
      ok: row.ok,
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
    const sums = await this.sumUsage(userId, config.resetAt);
    return sums.totalTokens;
  }

  private async sumsForUser(userId: string) {
    const config = await this.rates();
    return this.sumUsage(userId, config.resetAt);
  }

  /**
   * جمع SQL از نوع bigint است. aggregateٔ پریزما اگر از حد عدد ۳۲بیتی بگذرد
   * اتصال را می‌بندد و nginx برای همین درخواست ۵۰۲ برمی‌گرداند.
   */
  private async groupedUsage(resetAt: Date | null) {
    const rows = resetAt
      ? await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT "userId", section,
            COALESCE(SUM("promptTokens"), 0)::float8 AS "promptTokens",
            COALESCE(SUM("completionTokens"), 0)::float8 AS "completionTokens",
            COALESCE(SUM("totalTokens"), 0)::float8 AS "totalTokens",
            COALESCE(SUM("costRial"), 0)::float8 AS "costRial",
            COUNT(*)::float8 AS calls
          FROM "AiUsageLog"
          WHERE "createdAt" > ${resetAt} AND ok = true
          GROUP BY "userId", section
        `
      : await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT "userId", section,
            COALESCE(SUM("promptTokens"), 0)::float8 AS "promptTokens",
            COALESCE(SUM("completionTokens"), 0)::float8 AS "completionTokens",
            COALESCE(SUM("totalTokens"), 0)::float8 AS "totalTokens",
            COALESCE(SUM("costRial"), 0)::float8 AS "costRial",
            COUNT(*)::float8 AS calls
          FROM "AiUsageLog"
          WHERE ok = true
          GROUP BY "userId", section
        `;
    return rows.map((row) => ({
      userId: typeof row.userId === 'string' ? row.userId : null,
      section: typeof row.section === 'string' ? row.section : '',
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      costRial: row.costRial,
      calls: row.calls,
    }));
  }

  private async sumUsage(userId: string, resetAt: Date | null): Promise<UsageSums> {
    const rows = resetAt
      ? await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT
            COALESCE(SUM("promptTokens"), 0)::float8 AS "promptTokens",
            COALESCE(SUM("completionTokens"), 0)::float8 AS "completionTokens",
            COALESCE(SUM("totalTokens"), 0)::float8 AS "totalTokens",
            COALESCE(SUM("costRial"), 0)::float8 AS "costRial"
          FROM "AiUsageLog"
          WHERE "userId" = ${userId} AND "createdAt" > ${resetAt} AND ok = true
        `
      : await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT
            COALESCE(SUM("promptTokens"), 0)::float8 AS "promptTokens",
            COALESCE(SUM("completionTokens"), 0)::float8 AS "completionTokens",
            COALESCE(SUM("totalTokens"), 0)::float8 AS "totalTokens",
            COALESCE(SUM("costRial"), 0)::float8 AS "costRial"
          FROM "AiUsageLog"
          WHERE "userId" = ${userId} AND ok = true
        `;
    const row = rows[0] ?? {};
    return {
      promptTokens: asCount(row.promptTokens),
      completionTokens: asCount(row.completionTokens),
      totalTokens: asCount(row.totalTokens),
      costRial: asCount(row.costRial),
    };
  }
}

function usageInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), 2_000_000_000);
}

function usageText(value: string | undefined): string {
  return (value ?? '').replace(/\u0000/g, '').slice(0, USAGE_TEXT_MAX);
}

function historyActor(
  purpose: string,
  user: { name: string | null; email: string } | null,
): { userLabel: string; email: string | null } {
  if (SYSTEM_HISTORY_PURPOSES.has(purpose) || !user) {
    return { userLabel: 'سیستم', email: null };
  }
  const name = user.name?.trim();
  return { userLabel: name || user.email, email: user.email };
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

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}
