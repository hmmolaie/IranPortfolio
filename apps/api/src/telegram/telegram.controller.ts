import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class SaveTelegramConfigDto {
  @IsOptional()
  @IsString()
  botNameFa?: string;

  @IsOptional()
  @IsString()
  botUsername?: string;

  @IsOptional()
  @IsString()
  botToken?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class SendTodayDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller('telegram')
@UseGuards(JwtAuthGuard)
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('me')
  me(@Req() req: { user: { userId: string } }) {
    return this.telegram.getUserStatus(req.user.userId);
  }

  @Post('unlink')
  unlink(@Req() req: { user: { userId: string } }) {
    return this.telegram.unlink(req.user.userId);
  }

  @Get('config')
  @UseGuards(AdminGuard)
  getConfig() {
    return this.telegram.getPublicConfig();
  }

  @Put('config')
  @UseGuards(AdminGuard)
  saveConfig(@Body() dto: SaveTelegramConfigDto) {
    return this.telegram.saveConfig(dto);
  }

  @Post('test')
  @UseGuards(AdminGuard)
  test() {
    return this.telegram.testConnection();
  }

  @Post('send-today')
  @UseGuards(AdminGuard)
  sendToday(@Body() dto: SendTodayDto) {
    return this.telegram.deliverToday({ force: Boolean(dto.force) });
  }
}
