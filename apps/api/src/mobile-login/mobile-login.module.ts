import { Module } from '@nestjs/common';
import { MobileLoginController } from './mobile-login.controller';
import { MobileLoginService } from './mobile-login.service';

@Module({
  controllers: [MobileLoginController],
  providers: [MobileLoginService],
})
export class MobileLoginModule {}
