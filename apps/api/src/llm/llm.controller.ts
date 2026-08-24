import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';
import { LlmService } from './llm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class UpdateLlmDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  apiToken?: string;

  @IsOptional()
  @IsBoolean()
  usePlatformFallback?: boolean;
}

@Controller('llm')
@UseGuards(JwtAuthGuard)
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Get('settings')
  get(@Req() req: { user: { userId: string } }) {
    return this.llm.getPublicSettings(req.user.userId);
  }

  @Put('settings')
  put(@Req() req: { user: { userId: string } }, @Body() dto: UpdateLlmDto) {
    return this.llm.saveSettings(req.user.userId, dto);
  }
}
