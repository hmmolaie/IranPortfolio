import { Module } from '@nestjs/common';
import { FundsService } from './funds.service';
import { FundsController } from './funds.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [FundsService],
  controllers: [FundsController],
})
export class FundsModule {}
