import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { LlmModule } from '../llm/llm.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [LlmModule, AiUsageModule, UsersModule],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
