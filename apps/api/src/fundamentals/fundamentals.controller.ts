import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { FundamentalsService } from './fundamentals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from '../users/users.service';

/** صورت مالی کدال با پیوست‌ها گاهی چند ده مگابایت است */
const MAX_STATEMENT_BYTES = 40 * 1024 * 1024;

type AuthedReq = { user: { userId: string; role?: UserRole } };

@Controller('fundamentals')
@UseGuards(JwtAuthGuard)
export class FundamentalsController {
  constructor(
    private readonly fundamentals: FundamentalsService,
    private readonly users: UsersService,
  ) {}

  /** صورت‌های مالی ذخیره‌شدهٔ یک سهم؛ همهٔ کاربران می‌بینند، ادمین در حال آنالیز و ناموفق‌ها را هم */
  @Get('instruments/:id')
  forInstrument(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.fundamentals.listForInstrument(id, req.user.role === UserRole.ADMIN);
  }

  @Post('instruments/:id/upload')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_BYTES } }))
  upload(@Req() req: AuthedReq, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.fundamentals.upload(req.user.userId, id, file);
  }

  @Post('statements/:id/retry')
  @UseGuards(AdminGuard)
  retry(@Param('id') id: string) {
    return this.fundamentals.retry(id);
  }

  @Delete('statements/:id')
  @UseGuards(AdminGuard)
  remove(@Param('id') id: string) {
    return this.fundamentals.remove(id);
  }

  /** پیشنهادهای بنیادی؛ فقط برای ادمین و کاربری که دسترسی این صفحه را دارد */
  @Get('suggestions')
  async suggestions(@Req() req: AuthedReq) {
    if (!(await this.users.canUsePage(req.user.userId, 'fundamental'))) {
      throw new ForbiddenException('دسترسی به پیشنهادهای بنیادی برای حساب شما باز نشده است');
    }
    return this.fundamentals.suggestions();
  }
}
