import { Module } from '@nestjs/common';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';

@Module({
  imports: [AiUsageModule],
  providers: [LlmService],
  controllers: [LlmController],
  exports: [LlmService],
})
export class LlmModule {}
