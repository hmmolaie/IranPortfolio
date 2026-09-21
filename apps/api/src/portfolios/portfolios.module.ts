import { Module } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosController } from './portfolios.controller';
import { LlmModule } from '../llm/llm.module';
import { NewsModule } from '../news/news.module';
import { UsersModule } from '../users/users.module';
import { WorldMarketsModule } from '../world-markets/world-markets.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [LlmModule, NewsModule, UsersModule, WorldMarketsModule, WalletModule],
  providers: [PortfoliosService],
  controllers: [PortfoliosController],
  exports: [PortfoliosService],
})
export class PortfoliosModule {}
