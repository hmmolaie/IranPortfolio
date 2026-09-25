import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TradeFeesService } from './trade-fees.service';

class TradeFeesDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  stockBuyPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  stockSellPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  physicalUsdBuyPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  physicalUsdSellPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  physicalGoldBuyPct!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  physicalGoldSellPct!: number;
}

@Controller('trade-fees')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TradeFeesController {
  constructor(private readonly fees: TradeFeesService) {}

  @Get()
  read() {
    return this.fees.read();
  }

  @Put()
  save(@Body() dto: TradeFeesDto) {
    return this.fees.save(dto);
  }
}
