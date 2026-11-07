import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { UsersModule } from '../users/users.module';
import { PersonalDigestController } from './personal-digest.controller';
import { PersonalDigestService } from './personal-digest.service';

@Module({
  imports: [LlmModule, UsersModule],
  controllers: [PersonalDigestController],
  providers: [PersonalDigestService],
})
export class PersonalDigestModule {}
