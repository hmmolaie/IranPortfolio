import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { PricesService } from '../prices/prices.service';
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
  @Min(1)
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
    private readonly prices: PricesService,
  ) {}

  @Get('latest')
  async latest() {
    const [macro, spot] = await Promise.all([
      this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } }),
      this.prices.latest(),
    ]);
    if (!macro && !spot) return null;
    return {
      ...(macro ?? {}),
      usdIrr: spot?.usdIrr ?? macro?.usdIrr ?? null,
      goldGramRial: spot?.goldGramRial ?? null,
      spotDateKey: spot?.dateKey ?? null,
      sourceNoteFa: spot && 'sourceNoteFa' in spot ? spot.sourceNoteFa : null,
    };
  }

  @Put()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async upsert(@Body() dto: MacroDto) {
    const asOfDate = new Date();
    asOfDate.setUTCHours(0, 0, 0, 0);

    const { usdIrr, ...rest } = dto;
    let spotUsd = usdIrr;

    // نرخ دستی دلار → جدول قیمت روزانه (امروز ایران) + همگام با آخرین قیمت
    if (usdIrr != null && usdIrr > 0) {
      const spot = await this.prices.upsertManualSpot({ usdIrr });
      spotUsd = spot.usdIrr ?? usdIrr;
    } else {
      const spot = await this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } });
      spotUsd = spot?.usdIrr && spot.usdIrr > 0 ? spot.usdIrr : undefined;
    }

    const saved = await this.prisma.macroSnapshot.upsert({
      where: { asOfDate },
      create: { asOfDate, ...rest, ...(spotUsd != null ? { usdIrr: spotUsd } : {}) },
      update: { ...rest, ...(spotUsd != null ? { usdIrr: spotUsd } : {}) },
    });

    const spotLatest = await this.prices.latest();
    return {
      ...saved,
      usdIrr: spotLatest?.usdIrr ?? saved.usdIrr ?? null,
      goldGramRial: spotLatest?.goldGramRial ?? null,
      spotDateKey: spotLatest?.dateKey ?? null,
      sourceNoteFa: spotLatest && 'sourceNoteFa' in spotLatest ? spotLatest.sourceNoteFa : null,
    };
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
