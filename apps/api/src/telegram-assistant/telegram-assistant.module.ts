import { Module } from '@nestjs/common';
import { TelegramAssistantController } from './telegram-assistant.controller';
import { TelegramAssistantService } from './telegram-assistant.service';
import { LlmModule } from '../llm/llm.module';
import { UsersModule } from '../users/users.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [LlmModule, UsersModule, AiUsageModule],
  controllers: [TelegramAssistantController],
  providers: [TelegramAssistantService],
  exports: [TelegramAssistantService],
})
export class TelegramAssistantModule {}
