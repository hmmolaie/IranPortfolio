import { Module } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { LlmModule } from '../llm/llm.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [LlmModule, AiUsageModule],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
