import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AiUsageController } from './ai-usage.controller';
import { AiUsageInterceptor } from './ai-usage.interceptor';
import { AiUsageService } from './ai-usage.service';

@Module({
  controllers: [AiUsageController],
  providers: [AiUsageService, { provide: APP_INTERCEPTOR, useClass: AiUsageInterceptor }],
  exports: [AiUsageService],
})
export class AiUsageModule {}
