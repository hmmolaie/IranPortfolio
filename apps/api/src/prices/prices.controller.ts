import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { PricesService } from './prices.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class SaveConfigDto {
  @IsString()
  @MinLength(8)
  uri!: string;
}

class HistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days?: number;
}

@Controller('prices')
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('config')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getConfig() {
    return this.prices.getConfig();
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, AdminGuard)
  saveConfig(@Body() dto: SaveConfigDto) {
    return this.prices.saveConfig(dto.uri);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard, AdminGuard)
  refresh() {
    return this.prices.refreshFromApi();
  }

  @Get('latest')
  latest() {
    return this.prices.latest();
  }

  @Get('history')
  history(@Query() query: HistoryQueryDto) {
    return this.prices.history(query.days ?? 90);
  }
}
