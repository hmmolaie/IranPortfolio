import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { TelegramAssistantService } from './telegram-assistant.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class SaveAssistantConfigDto {
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

@Controller('telegram-assistant')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TelegramAssistantController {
  constructor(private readonly assistant: TelegramAssistantService) {}

  @Get('config')
  getConfig() {
    return this.assistant.getPublicConfig();
  }

  @Put('config')
  saveConfig(@Body() dto: SaveAssistantConfigDto) {
    return this.assistant.saveConfig(dto);
  }

  @Post('test')
  test() {
    return this.assistant.testConnection();
  }
}
