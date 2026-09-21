import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { NewsService } from './news.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class SaveRefreshScheduleDto {
  @IsInt()
  @Min(0)
  @Max(23)
  iranNewsHour!: number;

  @IsInt()
  @Min(0)
  @Max(59)
  iranNewsMinute!: number;

  @IsInt()
  @Min(0)
  @Max(23)
  worldHour!: number;

  @IsInt()
  @Min(0)
  @Max(59)
  worldMinute!: number;
}

class ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number;
}

@Controller('news')
@UseGuards(JwtAuthGuard)
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }, @Query() query: ListQueryDto) {
    return this.news.list(req.user.userId, query.days ?? 14);
  }

  @Post('refresh')
  @UseGuards(AdminGuard)
  refresh(@Req() req: { user: { userId: string } }) {
    return this.news.refresh(req.user.userId);
  }

  @Get('schedule')
  @UseGuards(AdminGuard)
  schedule() {
    return this.news.getRefreshSchedule();
  }

  @Put('schedule')
  @UseGuards(AdminGuard)
  saveSchedule(@Body() body: SaveRefreshScheduleDto) {
    return this.news.saveRefreshSchedule(body);
  }
}
