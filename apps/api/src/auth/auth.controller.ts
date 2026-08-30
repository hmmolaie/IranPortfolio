import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString()
  email!: string;

  @IsString()
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register() {
    throw new ForbiddenException('ثبت‌نام عمومی غیرفعال است. حساب توسط مدیر ساخته می‌شود.');
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
