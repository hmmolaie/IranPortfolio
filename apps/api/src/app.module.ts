import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { MarketModule } from './market/market.module';
import { PortfoliosModule } from './portfolios/portfolios.module';
import { LlmModule } from './llm/llm.module';
import { FundsModule } from './funds/funds.module';
import { MacroModule } from './macro/macro.module';
import { LessonsModule } from './lessons/lessons.module';

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
  ],
})
export class AppModule {}
