import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('lessons')
@UseGuards(JwtAuthGuard, AdminGuard)
export class LessonsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.prisma.lesson.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
