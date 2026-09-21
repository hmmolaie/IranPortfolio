import { Body, Controller, Get, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { WalletService } from './wallet.service';

class ChargeDto {
  @Type(() => Number)
  @IsInt()
  @Min(10_000)
  @Max(500_000_000)
  amountRial!: number;
}

class SaveWalletSettingsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  sandbox!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  merchantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  telegramDailyRial!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  suggestRial!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  rebalanceRial!: number;
}

class AdminCreditDto {
  @IsString()
  userId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500_000_000)
  amountRial!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('callback')
  async callback(
    @Query('Authority') authority: string,
    @Query('authority') authorityLower: string,
    @Query('Status') status: string,
    @Query('status') statusLower: string,
    @Res() res: Response,
  ) {
    try {
      const url = await this.wallet.handleCallback(authority || authorityLower, status || statusLower);
      res.redirect(url);
    } catch {
      const origin = (process.env.PUBLIC_URL || process.env.CORS_ORIGIN || '').split(',')[0]?.trim().replace(/\/+$/, '') || '';
      res.redirect(`${origin}/settings?wallet=fail`);
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  summary(@Req() req: { user: { userId: string } }) {
    return this.wallet.publicSummary(req.user.userId);
  }

  @Post('charge')
  @UseGuards(JwtAuthGuard)
  charge(@Req() req: { user: { userId: string } }, @Body() dto: ChargeDto) {
    return this.wallet.startCharge(req.user.userId, dto.amountRial);
  }

  @Get('admin/settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminSettings() {
    return this.wallet.adminSettings();
  }

  @Put('admin/settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  saveAdminSettings(@Body() dto: SaveWalletSettingsDto) {
    return this.wallet.saveAdminSettings(dto);
  }

  @Get('admin/users')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminUsers() {
    return this.wallet.listUsersForAdmin();
  }

  @Post('admin/credit')
  @UseGuards(JwtAuthGuard, AdminGuard)
  adminCredit(@Body() dto: AdminCreditDto) {
    return this.wallet.adminCredit(dto.userId, dto.amountRial, dto.note);
  }
}
