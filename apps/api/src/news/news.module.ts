import { Module } from '@nestjs/common';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';
import { LlmModule } from '../llm/llm.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [LlmModule, UsersModule],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
