import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { WorldMarketsService } from './world-markets.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('world-markets')
@UseGuards(JwtAuthGuard, AdminGuard)
export class WorldMarketsController {
  constructor(private readonly worldMarkets: WorldMarketsService) {}

  @Get()
  list() {
    return this.worldMarkets.list();
  }

  @Post('refresh')
  refresh() {
    return this.worldMarkets.refreshFromBitpin();
  }
}
