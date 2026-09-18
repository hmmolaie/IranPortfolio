import {
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { LessonsService } from './lessons.service';

@Controller('lessons')
@UseGuards(JwtAuthGuard, AdminGuard)
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.lessons.list(req.user.userId);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 35 * 1024 * 1024 },
    }),
  )
  uploadPdf(
    @Req() req: { user: { userId: string } },
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.lessons.ingestIranEconomyPdf(req.user.userId, file);
  }
}
