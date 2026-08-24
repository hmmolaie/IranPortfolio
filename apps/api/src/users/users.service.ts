import { Injectable } from '@nestjs/common';
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

  async create(email: string, password: string, name?: string) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        profile: { create: {} },
        llmSetting: { create: {} },
      },
      include: { profile: true },
    });
  }

  async updateProfile(
    userId: string,
    data: { name?: string; riskTolerance?: number; horizonMonths?: number; notes?: string },
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
