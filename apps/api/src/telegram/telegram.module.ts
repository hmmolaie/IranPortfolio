import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { PortfoliosModule } from '../portfolios/portfolios.module';
import { NewsModule } from '../news/news.module';
import { UsersModule } from '../users/users.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [PortfoliosModule, NewsModule, UsersModule, LlmModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
