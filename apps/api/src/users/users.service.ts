import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

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
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  async getAdminUserId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    return admin?.id ?? null;
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
      select: { id: true, email: true, name: true, role: true, createdAt: true },
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
    },
  ) {
    const { name, ...profile } = data;
    if (name !== undefined) {
      await this.prisma.user.update({ where: { id: userId }, data: { name } });
    }
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...profile },
      update: profile,
    });
  }
}
