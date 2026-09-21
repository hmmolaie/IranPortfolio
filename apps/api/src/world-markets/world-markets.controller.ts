import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { WorldMarketsService } from './world-markets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class SaveWorldSourceApiDto {
  @IsString()
  @MaxLength(500)
  bitpinMarketsUrl!: string;

  @IsString()
  @MaxLength(500)
  yahooQuoteUrl!: string;
}

@Controller('world-markets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WorldMarketsController {
  constructor(private readonly worldMarkets: WorldMarketsService) {}

  @Get()
  list() {
    return this.worldMarkets.list();
  }

  @Get('source-api')
  sourceApi() {
    return this.worldMarkets.getSourceApi();
  }

  @Put('source-api')
  saveSourceApi(@Body() body: SaveWorldSourceApiDto) {
    return this.worldMarkets.saveSourceApi(body);
  }

  @Post('refresh')
  refresh() {
    return this.worldMarkets.refreshFromBitpin();
  }

  @Get(':code/history')
  history(@Param('code') code: string) {
    return this.worldMarkets.getChart(decodeURIComponent(code));
  }
}
