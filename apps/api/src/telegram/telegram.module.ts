import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { PortfoliosModule } from '../portfolios/portfolios.module';
import { NewsModule } from '../news/news.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PortfoliosModule, NewsModule, UsersModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
