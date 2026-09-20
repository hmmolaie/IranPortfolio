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

function lastFinite<T extends { asOfDate: Date }>(
  rows: T[],
  pick: (row: T) => number | null | undefined,
): { value: number; asOfDate: Date } | null {
  for (const row of rows) {
    const v = pick(row);
    if (v != null && Number.isFinite(v)) return { value: v, asOfDate: row.asOfDate };
  }
  return null;
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
    const [snapshots, spot] = await Promise.all([
      this.prisma.macroSnapshot.findMany({
        orderBy: { asOfDate: 'desc' },
        take: 120,
      }),
      this.prices.latest(),
    ]);
    const macro = snapshots[0];
    if (!macro && !spot) return null;

    const inflation = lastFinite(snapshots, (s) => s.inflationPct);
    const interest = lastFinite(snapshots, (s) => s.interestRatePct);
    const latestDay = macro?.asOfDate?.getTime();

    return {
      ...(macro ?? {}),
      inflationPct: inflation?.value ?? null,
      interestRatePct: interest?.value ?? null,
      inflationAsOf:
        inflation && latestDay != null && inflation.asOfDate.getTime() !== latestDay
          ? inflation.asOfDate.toISOString()
          : null,
      interestRateAsOf:
        interest && latestDay != null && interest.asOfDate.getTime() !== latestDay
          ? interest.asOfDate.toISOString()
          : null,
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

    const prev = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    await this.prisma.macroSnapshot.upsert({
      where: { asOfDate },
      create: {
        asOfDate,
        inflationPct: rest.inflationPct ?? prev?.inflationPct,
        interestRatePct: rest.interestRatePct ?? prev?.interestRatePct,
        geoRiskScore: rest.geoRiskScore ?? prev?.geoRiskScore,
        summaryFa: rest.summaryFa ?? prev?.summaryFa,
        ...(spotUsd != null ? { usdIrr: spotUsd } : {}),
      },
      update: { ...rest, ...(spotUsd != null ? { usdIrr: spotUsd } : {}) },
    });

    return this.latest();
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
