import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { normalizeIranMobile } from '../common/iran-mobile';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { profile: true, llmSetting: true },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, llmSetting: true },
    });
  }

  async listForAdmin() {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        isActive: true,
        referralCode: true,
        referralActive: true,
        discountPct: true,
        optionsMarketAccess: true,
        profile: {
          select: { mobilePhone: true, telegramChatId: true, telegramUsername: true },
        },
        _count: { select: { clients: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.createdAt,
      isActive: row.isActive,
      referralCode: row.referralCode,
      referralActive: row.referralActive,
      discountPct: row.discountPct,
      optionsMarketAccess: row.optionsMarketAccess,
      clientCount: row._count.clients,
      mobilePhone: row.profile?.mobilePhone ?? null,
      telegramLinked: Boolean(row.profile?.telegramChatId),
      telegramUsername: row.profile?.telegramUsername ?? null,
    }));
  }

  async getAdminUserId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  async updateUserByAdmin(
    userId: string,
    data: { email?: string; name?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (user.role !== UserRole.USER && user.role !== UserRole.RESELLER)) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.email !== undefined ? { email: data.email.trim() } : {}),
        ...(data.name !== undefined ? { name: data.name.trim() || null } : {}),
      },
      select: { id: true, email: true, name: true, createdAt: true, isActive: true },
    });
  }

  async setPasswordByAdmin(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === UserRole.ADMIN) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('رمز عبور فعلی نادرست است');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async setActiveByAdmin(userId: string, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === UserRole.ADMIN) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, email: true, name: true, createdAt: true, isActive: true },
    });
  }

  async createUser(data: {
    email: string;
    password: string;
    name?: string;
    role?: UserRole;
  }) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: {
        email: data.email.trim(),
        passwordHash,
        name: data.name?.trim(),
        role: data.role ?? UserRole.USER,
        profile: { create: {} },
        llmSetting: { create: {} },
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true, isActive: true },
    });
  }

  async create(email: string, password: string, name?: string) {
    return this.createUser({ email, password, name });
  }

  async setRoleByAdmin(
    actorId: string,
    userId: string,
    role: UserRole,
    discountPct?: number,
  ) {
    if (actorId === userId) throw new BadRequestException('نقش حساب خودتان را عوض نکنید');
    if (role !== UserRole.USER && role !== UserRole.ADMIN && role !== UserRole.RESELLER) {
      throw new BadRequestException('نقش نامعتبر است');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      const admins = await this.prisma.user.count({ where: { role: UserRole.ADMIN, isActive: true } });
      if (admins <= 1) throw new BadRequestException('آخرین مدیر فعال را نمی‌توان به نقش دیگری برد');
    }
    const discount = this.normalizeDiscount(discountPct ?? user.discountPct);
    const data: Prisma.UserUpdateInput = { role, discountPct: role === UserRole.RESELLER ? discount : user.discountPct };
    if (role === UserRole.RESELLER) {
      data.referralCode = user.referralCode ?? (await this.freshReferralCode());
      data.referralActive = true;
      data.discountPct = discount;
    } else if (user.role === UserRole.RESELLER) {
      data.referralActive = false;
    }
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        referralCode: true,
        referralActive: true,
        discountPct: true,
      },
    });
  }

  async updateReferralByAdmin(
    userId: string,
    input: { referralCode?: string; referralActive?: boolean; discountPct?: number },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== UserRole.RESELLER) throw new NotFoundException('Reseller یافت نشد');
    const data: Prisma.UserUpdateInput = {};
    if (input.referralCode !== undefined) {
      const code = this.normalizeReferralCode(input.referralCode);
      const taken = await this.prisma.user.findFirst({
        where: { referralCode: code, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('این کد معرف قبلاً استفاده شده است');
      data.referralCode = code;
    }
    if (input.referralActive !== undefined) data.referralActive = input.referralActive;
    if (input.discountPct !== undefined) data.discountPct = this.normalizeDiscount(input.discountPct);
    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        referralCode: true,
        referralActive: true,
        discountPct: true,
      },
    });
  }

  async createForReseller(resellerId: string, data: { email: string; password: string; name?: string }) {
    const reseller = await this.requireActiveReseller(resellerId);
    try {
      const passwordHash = await bcrypt.hash(data.password, 10);
      return await this.prisma.user.create({
        data: {
          email: data.email.trim(),
          passwordHash,
          name: data.name?.trim() || null,
          role: UserRole.USER,
          resellerId: reseller.id,
          profile: { create: {} },
          llmSetting: { create: {} },
        },
        select: { id: true, email: true, name: true, role: true, createdAt: true, isActive: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('این نام کاربری قبلاً ثبت شده است');
      }
      throw e;
    }
  }

  async listForReseller(resellerId: string) {
    await this.requireActiveReseller(resellerId);
    const rows = await this.prisma.user.findMany({
      where: { resellerId, role: UserRole.USER },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        isActive: true,
        optionsMarketAccess: true,
      },
    });
    return rows;
  }

  async setPasswordByReseller(resellerId: string, userId: string, password: string) {
    await this.requireActiveReseller(resellerId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, resellerId, role: UserRole.USER },
    });
    if (!user) throw new NotFoundException('این کاربر برای شما نیست');
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async canUseOptionsMarket(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true, optionsMarketAccess: true },
    });
    if (!user?.isActive) return false;
    if (user.role === UserRole.ADMIN) return true;
    return user.optionsMarketAccess;
  }

  async setOptionsAccessByAdmin(userId: string, enabled: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role === UserRole.ADMIN) throw new NotFoundException('کاربر یافت نشد');
    await this.prisma.user.update({ where: { id: userId }, data: { optionsMarketAccess: enabled } });
    return { ok: true, optionsMarketAccess: enabled };
  }

  async setOptionsAccessByReseller(resellerId: string, userId: string, enabled: boolean) {
    await this.requireActiveReseller(resellerId);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, resellerId, role: UserRole.USER },
    });
    if (!user) throw new NotFoundException('این کاربر برای شما نیست');
    await this.prisma.user.update({ where: { id: userId }, data: { optionsMarketAccess: enabled } });
    return { ok: true, optionsMarketAccess: enabled };
  }

  async referralReport(actorId: string, role: string, fromRaw?: string, toRaw?: string) {
    const { from, to } = this.reportRange(fromRaw, toRaw);
    const where =
      role === UserRole.RESELLER ? { id: actorId, role: UserRole.RESELLER } : { role: UserRole.RESELLER };
    if (role !== UserRole.ADMIN && role !== UserRole.RESELLER) {
      throw new ForbiddenException('دسترسی به این گزارش ندارید');
    }
    const resellers = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        referralCode: true,
        referralActive: true,
        discountPct: true,
        _count: { select: { clients: true } },
      },
    });
    const rows = await Promise.all(
      resellers.map(async (reseller) => {
        const payments = await this.prisma.walletPayment.findMany({
          where: {
            resellerId: reseller.id,
            status: 'PAID',
            paidAt: { gte: from, lte: to },
          },
          select: { userId: true, amountRial: true, paidRial: true },
        });
        const users = new Set(payments.map((row) => row.userId));
        return {
          id: reseller.id,
          email: reseller.email,
          name: reseller.name,
          isActive: reseller.isActive,
          referralCode: reseller.referralCode,
          referralActive: reseller.referralActive,
          discountPct: reseller.discountPct,
          userCount: reseller._count.clients,
          chargeUserCount: users.size,
          chargeCount: payments.length,
          creditRial: payments.reduce((sum, row) => sum + row.amountRial, 0),
          paidRial: payments.reduce((sum, row) => sum + (row.paidRial > 0 ? row.paidRial : row.amountRial), 0),
        };
      }),
    );
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      rows,
    };
  }

  private async requireActiveReseller(userId: string) {
    const reseller = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!reseller || reseller.role !== UserRole.RESELLER) {
      throw new ForbiddenException('فقط Reseller می‌تواند کاربر تعریف کند');
    }
    if (!reseller.isActive) throw new ForbiddenException('حساب Reseller غیرفعال است');
    return reseller;
  }

  private normalizeDiscount(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 90) {
      throw new BadRequestException('درصد تخفیف باید عدد صحیح از ۰ تا ۹۰ باشد');
    }
    return value;
  }

  private normalizeReferralCode(raw: string): string {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      throw new BadRequestException('کد معرف باید ۴ تا ۱۶ حرف یا عدد انگلیسی باشد');
    }
    return code;
  }

  private async freshReferralCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let code = '';
      for (let i = 0; i < 8; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      const taken = await this.prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new BadRequestException('ساخت کد معرف ناموفق بود. دوباره تلاش کنید');
  }

  private reportRange(fromRaw?: string, toRaw?: string) {
    const today = new Date();
    const to = this.parseDay(toRaw, today);
    to.setUTCHours(23, 59, 59, 999);
    const fallback = new Date(to);
    fallback.setUTCDate(fallback.getUTCDate() - 30);
    const from = this.parseDay(fromRaw, fallback);
    from.setUTCHours(0, 0, 0, 0);
    if (from > to) throw new BadRequestException('تاریخ شروع بعد از تاریخ پایان است');
    return { from, to };
  }

  private parseDay(raw: string | undefined, fallback: Date): Date {
    if (!raw?.trim()) return new Date(fallback);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) throw new BadRequestException('تاریخ نامعتبر است');
    const date = new Date(`${raw.trim()}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    return date;
  }

  async updateProfile(
    userId: string,
    data: {
      name?: string;
      riskTolerance?: number;
      horizonMonths?: number;
      notes?: string;
      investmentPreferencesFa?: string;
      constraintsFa?: string;
      mobilePhone?: string;
      liquidityNeed?: string | null;
      maxDrawdownPct?: number | null;
      inflationSensitivity?: string | null;
      fxSensitivity?: string | null;
      objectiveFa?: string | null;
    },
  ) {
    const { name, mobilePhone, ...profile } = data;
    if (name !== undefined) {
      await this.prisma.user.update({ where: { id: userId }, data: { name } });
    }

    let mobile: string | null | undefined;
    if (mobilePhone !== undefined) {
      const trimmed = mobilePhone.trim();
      if (!trimmed) mobile = null;
      else {
        const n = normalizeIranMobile(trimmed);
        if (!n) throw new BadRequestException('شماره موبایل نامعتبر است (مثال: 09121234567)');
        mobile = n;
      }
    }

    const current = await this.prisma.userProfile.findUnique({ where: { userId } });
    const mobileChanged = mobile !== undefined && mobile !== (current?.mobilePhone ?? null);
    const unlinkTelegram = Boolean(mobileChanged);

    try {
      return await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...profile,
          ...(mobile !== undefined ? { mobilePhone: mobile } : {}),
        },
        update: {
          ...profile,
          ...(mobile !== undefined ? { mobilePhone: mobile } : {}),
          ...(unlinkTelegram
            ? { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null }
            : {}),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('این شماره موبایل قبلاً برای حساب دیگری ثبت شده است');
      }
      throw e;
    }
  }
}
