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
import { Allow, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AuthService } from './auth.service';
import { WebAuthnService } from './webauthn.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimit, clientIpFromHeaders } from '../common/rate-limit';
import type { SessionContext } from '../sessions/sessions.service';

type ClientRequest = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

/** آی‌پی و مرورگر کاربر برای سوابق ورود */
function sessionContext(req: ClientRequest): SessionContext {
  const ua = req.headers['user-agent'];
  return {
    ip: clientIpFromHeaders(req.headers, req.ip || req.socket?.remoteAddress),
    userAgent: Array.isArray(ua) ? ua[0] : ua,
  };
}

class LoginDto {
  @IsString()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MaxLength(200)
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
  @RateLimit(
    { scope: 'login', by: 'email', limit: 10, windowMs: 15 * 60_000 },
    { scope: 'login', by: 'ip', limit: 40, windowMs: 15 * 60_000 },
  )
  login(@Req() req: ClientRequest, @Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, sessionContext(req));
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  refresh(@Req() req: ClientRequest & { user: { userId: string; sid?: string } }) {
    return this.auth.refresh(req.user.userId, req.user.sid, sessionContext(req));
  }

  /** پایان نشست جاری؛ در سوابق ورود زمان خروج ثبت می‌شود */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Req() req: { user: { userId: string; sid?: string } }) {
    return this.auth.logout(req.user.userId, req.user.sid);
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
  @RateLimit({ scope: 'webauthn-login', by: 'ip', limit: 40, windowMs: 15 * 60_000 })
  webauthnLoginOptions(
    @Req() req: { headers: { origin?: string } },
    @Body() dto: WebAuthnLoginOptionsDto,
  ) {
    return this.webauthn.authenticationOptions(dto?.email, req.headers.origin);
  }

  @Post('webauthn/login/verify')
  @RateLimit({ scope: 'webauthn-login', by: 'ip', limit: 40, windowMs: 15 * 60_000 })
  webauthnLoginVerify(@Req() req: ClientRequest, @Body() dto: WebAuthnLoginVerifyDto) {
    const origin = req.headers.origin;
    return this.webauthn.verifyAuthentication(
      dto.response,
      Array.isArray(origin) ? origin[0] : origin,
      sessionContext(req),
    );
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
