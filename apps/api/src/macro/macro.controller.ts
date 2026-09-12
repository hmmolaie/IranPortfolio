import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class MacroDto {
  @IsOptional()
  @IsNumber()
  inflationPct?: number;

  @IsOptional()
  @IsNumber()
  interestRatePct?: number;

  @IsOptional()
  @IsNumber()
  usdIrr?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  geoRiskScore?: number;

  @IsOptional()
  @IsString()
  summaryFa?: string;
}

class AskDto {
  @IsString()
  question!: string;
}

@Controller('macro')
export class MacroController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  @Get('latest')
  async latest() {
    const [macro, spot] = await Promise.all([
      this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } }),
      this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } }),
    ]);
    if (!macro && !spot) return null;
    return {
      ...(macro ?? {}),
      usdIrr: spot?.usdIrr ?? macro?.usdIrr ?? null,
      goldGramRial: spot?.goldGramRial ?? null,
      spotDateKey: spot?.dateKey ?? null,
    };
  }

  @Put()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async upsert(@Body() dto: MacroDto) {
    const asOfDate = new Date();
    asOfDate.setUTCHours(0, 0, 0, 0);
    // نرخ دلار از API قیمت لحظه‌ای می‌آید؛ در فرم اقتصاد دستی ذخیره نمی‌شود
    const { usdIrr: _ignoredUsd, ...rest } = dto;
    const spot = await this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } });
    const usdIrr = spot?.usdIrr && spot.usdIrr > 0 ? spot.usdIrr : undefined;
    return this.prisma.macroSnapshot.upsert({
      where: { asOfDate },
      create: { asOfDate, ...rest, ...(usdIrr != null ? { usdIrr } : {}) },
      update: { ...rest, ...(usdIrr != null ? { usdIrr } : {}) },
    });
  }

  @Post('ask')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async ask(@Req() req: { user: { userId: string } }, @Body() dto: AskDto) {
    const macro = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const macroSystem = await this.llm.getSystemPrompt(req.user.userId, 'macro_qa');
    const answer = await this.llm.chatText(
      'macro_qa',
      macroSystem,
      `شرایط ثبت‌شده: ${JSON.stringify(macro)}\nسؤال کاربر: ${dto.question}`,
      req.user.userId,
    );
    return { answer, macro };
  }
}
