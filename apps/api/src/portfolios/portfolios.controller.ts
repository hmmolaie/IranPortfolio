import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PortfolioStrategy } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PortfoliosService } from './portfolios.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class CreatePortfolioDto {
  @IsString()
  name!: string;

  @IsEnum(PortfolioStrategy)
  strategy!: PortfolioStrategy;

  @IsNumber()
  @Min(0)
  capitalRial!: number;

  @IsOptional()
  @IsString()
  description?: string;
}

class WeightItemDto {
  @IsString()
  symbol!: string;

  @IsNumber()
  weightPct!: number;

  @IsOptional()
  @IsNumber()
  quantity?: number;
}

class AdjustDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeightItemDto)
  items!: WeightItemDto[];
}

class CashDto {
  @IsIn(['DEPOSIT_CASH', 'WITHDRAW_CASH', 'SELL'])
  type!: 'DEPOSIT_CASH' | 'WITHDRAW_CASH' | 'SELL';

  @IsNumber()
  @Min(0)
  amountRial!: number;

  @IsOptional()
  @IsString()
  symbol?: string;
}

@Controller('portfolios')
@UseGuards(JwtAuthGuard)
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.portfolios.list(req.user.userId);
  }

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() dto: CreatePortfolioDto) {
    return this.portfolios.create(req.user.userId, dto);
  }

  @Get(':id')
  get(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.get(req.user.userId, id);
  }

  @Post(':id/suggest')
  suggest(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.suggest(req.user.userId, id);
  }

  @Post(':id/rebalance')
  rebalance(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.rebalance(req.user.userId, id);
  }

  @Post(':id/monthly-evaluate')
  monthly(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.monthlyEvaluate(req.user.userId, id);
  }

  @Post(':id/adjust')
  adjust(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: AdjustDto,
  ) {
    return this.portfolios.adjustWeights(req.user.userId, id, dto.items);
  }

  @Post(':id/cash')
  cash(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: CashDto,
  ) {
    return this.portfolios.cashEvent(req.user.userId, id, dto.type, dto.amountRial, dto.symbol);
  }
}
