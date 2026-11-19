import { Module } from '@nestjs/common';
import { FundamentalsService } from './fundamentals.service';
import { FundamentalsController } from './fundamentals.controller';
import { LlmModule } from '../llm/llm.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [LlmModule, UsersModule],
  providers: [FundamentalsService],
  controllers: [FundamentalsController],
  exports: [FundamentalsService],
})
export class FundamentalsModule {}
