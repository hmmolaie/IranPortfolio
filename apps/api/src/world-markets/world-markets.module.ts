import { Module } from '@nestjs/common';
import { WorldMarketsController } from './world-markets.controller';
import { WorldMarketsService } from './world-markets.service';
import { PricesModule } from '../prices/prices.module';

@Module({
  imports: [PricesModule],
  controllers: [WorldMarketsController],
  providers: [WorldMarketsService],
  exports: [WorldMarketsService],
})
export class WorldMarketsModule {}
