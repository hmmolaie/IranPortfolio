import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
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

class RefreshErrorDto {
  @IsInt()
  @Min(0)
  @Max(599)
  status!: number;

  @IsString()
  @MaxLength(8000)
  detail!: string;
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
    return this.worldMarkets.startManualRefresh();
  }

  @Get('refresh-status')
  refreshStatus() {
    return this.worldMarkets.refreshStatus();
  }

  @Post('refresh-error')
  refreshError(@Req() req: { user: { userId: string } }, @Body() body: RefreshErrorDto) {
    return this.worldMarkets.recordClientRefreshError(req.user.userId, body.status, body.detail);
  }

  @Get(':code/history')
  history(@Param('code') code: string) {
    return this.worldMarkets.getChart(decodeURIComponent(code));
  }
}
