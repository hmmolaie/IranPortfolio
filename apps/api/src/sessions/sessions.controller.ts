import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { SessionsService } from './sessions.service';

type AuthedRequest = { user: { userId: string; sid?: string } };

/** کاربران داخل سایت، اخراج و سوابق ورود؛ فقط ادمین */
@Controller('admin/sessions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('online')
  online() {
    return this.sessions.online();
  }

  @Post(':id/kick')
  kick(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sessions.kick(id, req.user.userId, req.user.sid);
  }

  @Get('history')
  history(
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.sessions.history({
      userId: userId?.trim() || undefined,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
    });
  }
}
