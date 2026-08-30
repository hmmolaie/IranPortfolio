import { Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

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

  @Get('instruments/:id/history')
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.market.getPriceHistory(id, limit ? Number(limit) : 90);
  }

  @Get('instruments/:id')
  async detail(@Param('id') id: string) {
    const inst = await this.market.getInstrument(id);
    if (!inst) throw new NotFoundException('نماد یافت نشد');
    return inst;
  }

  @Post('ingest')
  @UseGuards(JwtAuthGuard, AdminGuard)
  ingest() {
    return this.market.ingestCatchUp();
  }
}
