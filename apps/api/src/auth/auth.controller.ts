import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Allow, IsObject, IsOptional, IsString } from 'class-validator';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { WebAuthnService } from './webauthn.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class LoginDto {
  @IsString()
  email!: string;

  @IsString()
  password!: string;
}

class WebAuthnLoginOptionsDto {
  @IsOptional()
  @IsString()
  email?: string;
}

class WebAuthnRegisterVerifyDto {
  @Allow()
  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  nickname?: string;
}

class WebAuthnLoginVerifyDto {
  @Allow()
  @IsObject()
  response!: AuthenticationResponseJSON;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @Post('register')
  register() {
    throw new ForbiddenException('ثبت‌نام عمومی غیرفعال است. حساب توسط مدیر ساخته می‌شود.');
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  refresh(@Req() req: { user: { userId: string } }) {
    return this.auth.refresh(req.user.userId);
  }

  @Post('webauthn/register/options')
  @UseGuards(JwtAuthGuard)
  webauthnRegisterOptions(@Req() req: { user: { userId: string }; headers: { origin?: string } }) {
    return this.webauthn.registrationOptions(req.user.userId, req.headers.origin);
  }

  @Post('webauthn/register/verify')
  @UseGuards(JwtAuthGuard)
  webauthnRegisterVerify(
    @Req() req: { user: { userId: string }; headers: { origin?: string } },
    @Body() dto: WebAuthnRegisterVerifyDto,
  ) {
    return this.webauthn.verifyRegistration(req.user.userId, dto.response, dto.nickname, req.headers.origin);
  }

  @Post('webauthn/login/options')
  webauthnLoginOptions(
    @Req() req: { headers: { origin?: string } },
    @Body() dto: WebAuthnLoginOptionsDto,
  ) {
    return this.webauthn.authenticationOptions(dto?.email, req.headers.origin);
  }

  @Post('webauthn/login/verify')
  webauthnLoginVerify(
    @Req() req: { headers: { origin?: string } },
    @Body() dto: WebAuthnLoginVerifyDto,
  ) {
    return this.webauthn.verifyAuthentication(dto.response, req.headers.origin);
  }

  @Get('webauthn/credentials')
  @UseGuards(JwtAuthGuard)
  webauthnList(@Req() req: { user: { userId: string } }) {
    return this.webauthn.listCredentials(req.user.userId);
  }

  @Delete('webauthn/credentials/:id')
  @UseGuards(JwtAuthGuard)
  webauthnRemove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.webauthn.removeCredential(req.user.userId, id);
  }
}
