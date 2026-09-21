import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { IntelligenceService } from './intelligence.service';

class ScenarioDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-80)
  @Max(200)
  equityPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-80)
  @Max(200)
  fixedPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-80)
  @Max(200)
  goldPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-80)
  @Max(200)
  usdPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-80)
  @Max(200)
  cashPct?: number;
}

@Controller('intelligence')
@UseGuards(JwtAuthGuard)
export class IntelligenceController {
  constructor(private readonly intelligence: IntelligenceService) {}

  @Get('regime')
  regime() {
    return this.intelligence.currentRegime(true);
  }

  @Get('home')
  home(@Req() req: { user: { userId: string } }) {
    return this.intelligence.home(req.user.userId);
  }

  @Get('data-health')
  @UseGuards(AdminGuard)
  dataHealth() {
    return this.intelligence.dataHealth();
  }

  @Get('portfolios/:id')
  portfolio(@Req() req: { user: { userId: string; role?: string } }, @Param('id') id: string) {
    return this.intelligence.portfolio(req.user.userId, id, req.user.role === UserRole.ADMIN);
  }

  @Get('portfolios/:id/history')
  history(@Req() req: { user: { userId: string; role?: string } }, @Param('id') id: string) {
    return this.intelligence.history(req.user.userId, id, req.user.role === UserRole.ADMIN);
  }

  @Post('portfolios/:id/scenario')
  scenario(
    @Req() req: { user: { userId: string; role?: string } },
    @Param('id') id: string,
    @Body() dto: ScenarioDto,
  ) {
    return this.intelligence.scenarioForPortfolio(req.user.userId, id, req.user.role === UserRole.ADMIN, {
      equity: dto.equityPct,
      fixed: dto.fixedPct,
      gold: dto.goldPct,
      usd: dto.usdPct,
      cash: dto.cashPct,
    });
  }
}
