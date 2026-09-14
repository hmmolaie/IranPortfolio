import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
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

  listForAdmin() {
    return this.prisma.user.findMany({
      where: { role: UserRole.USER },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        isActive: true,
        profile: { select: { mobilePhone: true, telegramChatId: true } },
      },
    });
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
    if (!user || user.role !== UserRole.USER) {
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
    if (!user || user.role !== UserRole.USER) {
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
    if (!user || user.role !== UserRole.USER) {
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
