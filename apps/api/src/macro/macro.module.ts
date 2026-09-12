import { Module } from '@nestjs/common';
import { MacroController } from './macro.controller';
import { LlmModule } from '../llm/llm.module';
import { PricesModule } from '../prices/prices.module';

@Module({
  imports: [LlmModule, PricesModule],
  controllers: [MacroController],
})
export class MacroModule {}
