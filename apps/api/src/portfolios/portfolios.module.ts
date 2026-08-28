import { Module } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosController } from './portfolios.controller';
import { LlmModule } from '../llm/llm.module';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [LlmModule, NewsModule],
  providers: [PortfoliosService],
  controllers: [PortfoliosController],
})
export class PortfoliosModule {}
