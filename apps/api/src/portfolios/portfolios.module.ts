import { Module } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { PortfoliosController } from './portfolios.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [PortfoliosService],
  controllers: [PortfoliosController],
})
export class PortfoliosModule {}
