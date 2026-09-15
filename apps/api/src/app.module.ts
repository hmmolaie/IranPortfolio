import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MarketModule } from './market/market.module';
import { PortfoliosModule } from './portfolios/portfolios.module';
import { LlmModule } from './llm/llm.module';
import { FundsModule } from './funds/funds.module';
import { MacroModule } from './macro/macro.module';
import { LessonsModule } from './lessons/lessons.module';
import { NewsModule } from './news/news.module';
import { PricesModule } from './prices/prices.module';
import { TelegramModule } from './telegram/telegram.module';
import { WorldMarketsModule } from './world-markets/world-markets.module';
import { ForexModule } from './forex/forex.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    MarketModule,
    PortfoliosModule,
    LlmModule,
    FundsModule,
    MacroModule,
    LessonsModule,
    NewsModule,
    PricesModule,
    TelegramModule,
    WorldMarketsModule,
    ForexModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
