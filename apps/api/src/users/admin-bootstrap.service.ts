import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const admin = await this.prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
    if (admin) return;

    const passwordHash = await bcrypt.hash('123456', 10);
    await this.prisma.user.create({
      data: {
        email: 'admin',
        passwordHash,
        name: 'مدیر سیستم',
        role: UserRole.ADMIN,
        profile: { create: {} },
        llmSetting: { create: {} },
      },
    });
    this.logger.log('کاربر admin با رمز اولیه 123456 ایجاد شد');
  }
}
