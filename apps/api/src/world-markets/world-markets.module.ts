import { Module } from '@nestjs/common';
import { WorldMarketsController } from './world-markets.controller';
import { WorldMarketsService } from './world-markets.service';
import { PricesModule } from '../prices/prices.module';
import { LlmModule } from '../llm/llm.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PricesModule, LlmModule, UsersModule],
  controllers: [WorldMarketsController],
  providers: [WorldMarketsService],
  exports: [WorldMarketsService],
})
export class WorldMarketsModule {}
