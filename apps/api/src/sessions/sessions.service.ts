import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** کاربری که در این بازه درخواستی (حداقل تازه‌سازی توکن هر دقیقه) داشته، داخل سایت حساب می‌شود */
export const ONLINE_WINDOW_MS = 3 * 60_000;
/** lastSeenAt حداکثر هر ۳۰ ثانیه یک‌بار نوشته می‌شود */
const TOUCH_EVERY_MS = 30_000;
/** سوابق ورود قدیمی‌تر از این پاک می‌شوند */
const KEEP_DAYS = 180;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;

export type SessionContext = {
  ip?: string | null;
  userAgent?: string | null;
  method?: 'password' | 'webauthn';
};

const USER_SELECT = { id: true, email: true, name: true, role: true } as const;

@Injectable()
export class SessionsService {
  private lastPruneAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, ctx: SessionContext = {}): Promise<string> {
    const row = await this.prisma.userSession.create({
      data: {
        userId,
        ip: ctx.ip?.slice(0, 64) || null,
        userAgent: ctx.userAgent?.slice(0, 400) || null,
        method: ctx.method ?? 'password',
      },
      select: { id: true },
    });
    void this.pruneIfDue();
    return row.id;
  }

  /**
   * نشست هنوز باز است؟ اگر بله lastSeenAt را (با فاصلهٔ حداقل ۳۰ ثانیه) تازه می‌کند.
   * نشست اخراج‌شده یا خارج‌شده false برمی‌گرداند.
   */
  async touch(sid: string, userId: string): Promise<boolean> {
    const row = await this.prisma.userSession.findUnique({
      where: { id: sid },
      select: { userId: true, endedAt: true, lastSeenAt: true },
    });
    if (!row || row.userId !== userId || row.endedAt) return false;
    const now = Date.now();
    if (now - row.lastSeenAt.getTime() >= TOUCH_EVERY_MS) {
      await this.prisma.userSession
        .updateMany({ where: { id: sid, endedAt: null }, data: { lastSeenAt: new Date(now) } })
        .catch(() => undefined);
    }
    return true;
  }

  async end(sid: string, userId: string) {
    await this.prisma.userSession.updateMany({
      where: { id: sid, userId, endedAt: null },
      data: { endedAt: new Date(), endReason: 'logout' },
    });
    return { ok: true };
  }

  /** کاربرانی که همین الان داخل سایت‌اند */
  async online() {
    const since = new Date(Date.now() - ONLINE_WINDOW_MS);
    const rows = await this.prisma.userSession.findMany({
      where: { endedAt: null, lastSeenAt: { gte: since } },
      orderBy: { loginAt: 'desc' },
      take: 500,
      include: { user: { select: USER_SELECT } },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      user: r.user,
      ip: r.ip,
      userAgent: r.userAgent,
      method: r.method,
      loginAt: r.loginAt,
      lastSeenAt: r.lastSeenAt,
      durationSec: Math.max(0, Math.round((now - r.loginAt.getTime()) / 1000)),
    }));
  }

  /** فقط نشستی که الان داخل سایت است اخراج می‌شود */
  async kick(sessionId: string, adminId: string, currentSid?: string) {
    if (currentSid && currentSid === sessionId) {
      throw new BadRequestException('نشست خودتان را نمی‌توانید اخراج کنید؛ از دکمهٔ خروج استفاده کنید.');
    }
    const since = new Date(Date.now() - ONLINE_WINDOW_MS);
    const res = await this.prisma.userSession.updateMany({
      where: { id: sessionId, endedAt: null, lastSeenAt: { gte: since } },
      data: { endedAt: new Date(), endReason: 'kicked', endedById: adminId },
    });
    if (!res.count) throw new NotFoundException('این کاربر الان داخل سایت نیست.');
    return { ok: true };
  }

  /** سوابق ورود؛ مدت استفاده از ورود تا آخرین درخواست (یا خروج) است */
  async history(params: { userId?: string; page?: number; pageSize?: number }) {
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
    const page = Math.max(1, params.page ?? 1);
    const where = params.userId ? { userId: params.userId } : {};
    const [total, rows] = await Promise.all([
      this.prisma.userSession.count({ where }),
      this.prisma.userSession.findMany({
        where,
        orderBy: { loginAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: USER_SELECT } },
      }),
    ]);
    const now = Date.now();
    const onlineSince = now - ONLINE_WINDOW_MS;
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => {
        const online = !r.endedAt && r.lastSeenAt.getTime() >= onlineSince;
        const end = r.endedAt ?? (online ? new Date(now) : r.lastSeenAt);
        return {
          id: r.id,
          user: r.user,
          ip: r.ip,
          userAgent: r.userAgent,
          method: r.method,
          loginAt: r.loginAt,
          lastSeenAt: r.lastSeenAt,
          endedAt: r.endedAt,
          /** online | logout | kicked | idle (بدون خروج، فعالیت متوقف شد) */
          status: online ? 'online' : (r.endReason ?? 'idle'),
          durationSec: Math.max(0, Math.round((end.getTime() - r.loginAt.getTime()) / 1000)),
        };
      }),
    };
  }

  private async pruneIfDue() {
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_EVERY_MS) return;
    this.lastPruneAt = now;
    await this.prisma.userSession
      .deleteMany({ where: { loginAt: { lt: new Date(now - KEEP_DAYS * 24 * 60 * 60_000) } } })
      .catch(() => undefined);
  }
}
