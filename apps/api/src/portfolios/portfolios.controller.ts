import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AssetType, PortfolioStrategy } from '@prisma/client';
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

class ChatDto {
  @IsString()
  message!: string;
}

class StrategyItemDto {
  @IsString()
  symbol!: string;

  @IsEnum(AssetType)
  assetType!: AssetType;

  @IsNumber()
  weightPct!: number;

  @IsString()
  reasonFa!: string;
}

class ApplyStrategyDto {
  @IsOptional()
  @IsString()
  labelFa?: string;

  @IsString()
  strategySummaryFa!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyItemDto)
  items!: StrategyItemDto[];
}

@Controller('portfolios')
@UseGuards(JwtAuthGuard)
export class PortfoliosController {
  constructor(private readonly portfolios: PortfoliosService) {}

  @Get()
  list(
    @Req() req: { user: { userId: string; role?: UserRole } },
    @Query('userId') userId?: string,
  ) {
    const targetUserId =
      req.user.role === UserRole.ADMIN && userId ? userId : req.user.userId;
    return this.portfolios.list(targetUserId);
  }

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() dto: CreatePortfolioDto) {
    return this.portfolios.create(req.user.userId, dto);
  }

  @Get(':id')
  get(@Req() req: { user: { userId: string; role?: UserRole } }, @Param('id') id: string) {
    const isAdmin = req.user.role === UserRole.ADMIN;
    return this.portfolios.get(req.user.userId, id, isAdmin);
  }

  @Get(':id/chat')
  getChat(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.getChat(req.user.userId, id);
  }

  @Post(':id/chat')
  postChat(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: ChatDto,
  ) {
    return this.portfolios.postChat(req.user.userId, id, dto.message);
  }

  @Post(':id/suggest-strategies')
  suggestStrategies(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.portfolios.suggestStrategies(req.user.userId, id);
  }

  @Post(':id/apply-strategy')
  applyStrategy(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: ApplyStrategyDto,
  ) {
    return this.portfolios.applyStrategy(req.user.userId, id, dto);
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
