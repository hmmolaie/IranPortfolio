import { Module } from '@nestjs/common';
import { MacroController } from './macro.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [MacroController],
})
export class MacroModule {}
