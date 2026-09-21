import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { PortfoliosModule } from '../portfolios/portfolios.module';
import { NewsModule } from '../news/news.module';
import { UsersModule } from '../users/users.module';
import { LlmModule } from '../llm/llm.module';
import { WalletModule } from '../wallet/wallet.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [PortfoliosModule, NewsModule, UsersModule, LlmModule, WalletModule, IntelligenceModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
