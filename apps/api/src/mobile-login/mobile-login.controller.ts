import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimit } from '../common/rate-limit';
import { clientIpFromHeaders, MobileLoginService } from './mobile-login.service';

class LocationDto {
  @IsString()
  @MaxLength(40)
  location!: string;
}

class MobileDto {
  @IsString()
  @MaxLength(20)
  mobilePhone!: string;
}

class EnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

type ReqWithIp = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Controller('mobile-login')
export class MobileLoginController {
  constructor(private readonly mobileLogin: MobileLoginService) {}

  @Get('status')
  status() {
    return this.mobileLogin.isEnabled().then((enabled) => ({ enabled }));
  }

  @Post('visits')
  @RateLimit(
    { scope: 'mobile-visit', by: 'ip', limit: 30, windowMs: 60 * 60_000 },
    { scope: 'mobile-visit', by: 'all', limit: 3000, windowMs: 60 * 60_000 },
  )
  open(@Req() req: ReqWithIp) {
    return this.mobileLogin.openVisit(this.ip(req));
  }

  @Patch('visits/:id/location')
  @RateLimit({ scope: 'mobile-visit-edit', by: 'ip', limit: 60, windowMs: 60 * 60_000 })
  location(@Param('id') id: string, @Body() dto: LocationDto) {
    return this.mobileLogin.saveLocation(id, dto.location);
  }

  @Patch('visits/:id/mobile')
  @RateLimit({ scope: 'mobile-visit-edit', by: 'ip', limit: 60, windowMs: 60 * 60_000 })
  mobile(@Param('id') id: string, @Body() dto: MobileDto) {
    return this.mobileLogin.saveMobile(id, dto.mobilePhone);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminList() {
    return this.mobileLogin.listForAdmin();
  }

  @Delete('admin/logs')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminClearLogs() {
    return this.mobileLogin.clearLogs();
  }

  @Put('admin/config')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminConfig(@Body() dto: EnabledDto) {
    return this.mobileLogin.setEnabled(dto.enabled);
  }

  private ip(req: ReqWithIp): string | null {
    return clientIpFromHeaders(req.headers, req.ip || req.socket?.remoteAddress);
  }
}
