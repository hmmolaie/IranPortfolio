import { Module } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosController } from './portfolios.controller';
import { LlmModule } from '../llm/llm.module';
import { NewsModule } from '../news/news.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [LlmModule, NewsModule, UsersModule],
  providers: [PortfoliosService],
  controllers: [PortfoliosController],
})
export class PortfoliosModule {}
