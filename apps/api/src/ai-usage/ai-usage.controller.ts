import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiUsageService } from './ai-usage.service';

class AiUsageConfigDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  promptRialPer1k!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  completionRialPer1k!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultQuotaTokens!: number;
}

class AiUserQuotaDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  limitTokens!: number;
}

class AiHistoryQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  section?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@Controller('ai-usage')
@UseGuards(JwtAuthGuard)
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('me')
  me(@Req() req: { user: { userId: string } }) {
    return this.usage.me(req.user.userId);
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  admin() {
    return this.usage.adminReport();
  }

  @Get('history')
  @UseGuards(AdminGuard)
  history(@Query() query: AiHistoryQueryDto) {
    return this.usage.history(query);
  }

  @Get('history/:id')
  @UseGuards(AdminGuard)
  historyItem(@Param('id') id: string) {
    return this.usage.historyItem(id);
  }

  @Put('config')
  @UseGuards(AdminGuard)
  saveConfig(@Body() dto: AiUsageConfigDto) {
    return this.usage.saveConfig(dto);
  }

  @Put('users/:userId/quota')
  @UseGuards(AdminGuard)
  saveQuota(@Param('userId') userId: string, @Body() dto: AiUserQuotaDto) {
    return this.usage.saveUserQuota(userId, dto.limitTokens);
  }

  @Post('reset')
  @UseGuards(AdminGuard)
  reset() {
    return this.usage.reset();
  }
}
