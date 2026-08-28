import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
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

class UpdatePromptDto {
  @IsString()
  systemPrompt!: string;
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

  @Get('prompts')
  listPrompts(@Req() req: { user: { userId: string } }) {
    return this.llm.listPrompts(req.user.userId);
  }

  @Put('prompts/:purpose')
  savePrompt(
    @Req() req: { user: { userId: string } },
    @Param('purpose') purpose: string,
    @Body() dto: UpdatePromptDto,
  ) {
    return this.llm.savePrompt(req.user.userId, purpose, dto.systemPrompt);
  }

  @Delete('prompts/:purpose')
  resetPrompt(@Req() req: { user: { userId: string } }, @Param('purpose') purpose: string) {
    return this.llm.resetPrompt(req.user.userId, purpose);
  }
}
