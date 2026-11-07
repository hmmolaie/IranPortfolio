import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { MAX_ITEMS_PER_TOPIC, MAX_TOPICS, PersonalDigestService } from './personal-digest.service';

class DigestTopicDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  titleFa!: string;

  @IsString()
  @MaxLength(600)
  focusFa!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ITEMS_PER_TOPIC)
  itemsCount!: number;
}

class SavePersonalDigestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  botUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  botToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  chatId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  intervalHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  startHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(59)
  sendMinute?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TOPICS)
  @ValidateNested({ each: true })
  @Type(() => DigestTopicDto)
  topics?: DigestTopicDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** فقط مدیر؛ جدا از اطلاع‌رسانی کاربران سبدیار */
@Controller('personal-digest')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PersonalDigestController {
  constructor(private readonly digest: PersonalDigestService) {}

  @Get('config')
  getConfig() {
    return this.digest.getPublicConfig();
  }

  @Put('config')
  saveConfig(@Body() dto: SavePersonalDigestDto) {
    return this.digest.saveConfig(dto);
  }

  @Post('detect-chat')
  detectChat() {
    return this.digest.detectChat();
  }

  @Post('test-message')
  testMessage() {
    return this.digest.sendTestMessage();
  }

  @Post('send-now')
  sendNow() {
    return this.digest.startSendNow();
  }
}
