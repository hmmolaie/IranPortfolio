import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

  @IsOptional()
  @IsString()
  ttsModel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  sendHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  sendMinute?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  sendWeekdays?: number[];
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

  @Get('links')
  @UseGuards(AdminGuard)
  listLinks() {
    return this.telegram.listLinkedUsers();
  }

  @Post('links/:userId/unlink')
  @UseGuards(AdminGuard)
  unlinkUser(@Param('userId') userId: string) {
    return this.telegram.unlinkByAdmin(userId);
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

  @Post('test-message')
  @UseGuards(AdminGuard)
  testMessage(@Req() req: { user: { userId: string } }) {
    return this.telegram.sendTestToAdmin(req.user.userId);
  }

  @Post('send-today')
  @UseGuards(AdminGuard)
  sendToday(@Body() dto: SendTodayDto) {
    return this.telegram.startDeliverToday(Boolean(dto.force));
  }
}
