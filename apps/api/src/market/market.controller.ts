import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('quotes')
  list(
    @Query('q') q?: string,
    @Query('assetType') assetType?: AssetType,
    @Query('take') take?: string,
  ) {
    return this.market.listLatest({
      q,
      assetType,
      take: take ? Number(take) : undefined,
    });
  }

  @Post('ingest')
  @UseGuards(JwtAuthGuard)
  ingest() {
    return this.market.ingestToday();
  }
}
