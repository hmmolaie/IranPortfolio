import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { NewsService } from './news.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

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
  refresh(@Req() req: { user: { userId: string } }) {
    return this.news.refresh(req.user.userId);
  }
}
