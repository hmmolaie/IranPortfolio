import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { FundamentalsService } from './fundamentals.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from '../users/users.service';
import { CodalStatementSyncService } from './codal-statement-sync.service';

/** صورت مالی کدال با پیوست‌ها گاهی چند ده مگابایت است */
const MAX_STATEMENT_BYTES = 40 * 1024 * 1024;

type AuthedReq = { user: { userId: string; role?: UserRole } };

/** مشخصات اطلاعیهٔ کدال که ادمین کنار فایل می‌فرستد (اختیاری) */
class UploadStatementDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  noticeTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  publishedAtFa?: string;
}

class CodalWindowDto {
  @IsString()
  @MaxLength(20)
  fromDateFa!: string;

  @IsString()
  @MaxLength(20)
  toDateFa!: string;
}

class CodalRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fromDateFa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  toDateFa?: string;
}

class RecordedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

@Controller('fundamentals')
@UseGuards(JwtAuthGuard)
export class FundamentalsController {
  constructor(
    private readonly fundamentals: FundamentalsService,
    private readonly users: UsersService,
    private readonly codalSync: CodalStatementSyncService,
  ) {}

  /** همگام‌سازی صورت‌های مالی از کدال: بازه، آخرین اجرا و جدول پیشرفت اجرای جاری */
  @Get('codal-sync')
  @UseGuards(AdminGuard)
  codalSyncStatus() {
    return this.codalSync.status();
  }

  @Put('codal-sync')
  @UseGuards(AdminGuard)
  saveCodalWindow(@Body() body: CodalWindowDto) {
    return this.codalSync.saveWindow(body.fromDateFa, body.toDateFa);
  }

  /** اجرای دستی با بازهٔ واردشده؛ در پس‌زمینه */
  @Post('codal-sync/run')
  @UseGuards(AdminGuard)
  runCodalSync(@Body() body: CodalRunDto) {
    return this.codalSync.runManual(body.fromDateFa, body.toDateFa);
  }

  /** صورت‌های مالی ثبت‌شده (بارگذاری دستی و کدال) با نماد، عنوان اطلاعیه، زمان انتشار و زمان ثبت */
  @Get('recorded')
  @UseGuards(AdminGuard)
  recorded(@Query() query: RecordedQueryDto) {
    return this.fundamentals.recordedStatements(query.limit ?? 300);
  }

  /** صورت‌های مالی ذخیره‌شدهٔ یک سهم؛ همهٔ کاربران می‌بینند، ادمین در حال آنالیز و ناموفق‌ها را هم */
  @Get('instruments/:id')
  forInstrument(@Req() req: AuthedReq, @Param('id') id: string) {
    return this.fundamentals.listForInstrument(id, req.user.role === UserRole.ADMIN);
  }

  @Post('instruments/:id/upload')
  @UseGuards(AdminGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STATEMENT_BYTES } }))
  upload(
    @Req() req: AuthedReq,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadStatementDto,
  ) {
    return this.fundamentals.upload(req.user.userId, id, file, body);
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
