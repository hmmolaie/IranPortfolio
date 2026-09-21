import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { LessonsService } from './lessons.service';

class CreateLessonDto {
  @IsString()
  @MaxLength(180)
  titleFa!: string;

  @IsString()
  @MaxLength(4000)
  bodyFa!: string;
}

@Controller('lessons')
@UseGuards(JwtAuthGuard, AdminGuard)
export class LessonsController {
  constructor(private readonly lessons: LessonsService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.lessons.list(req.user.userId);
  }

  @Post()
  create(@Req() req: { user: { userId: string } }, @Body() body: CreateLessonDto) {
    return this.lessons.createManual(req.user.userId, body);
  }

  @Delete(':id')
  remove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.lessons.remove(req.user.userId, id);
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
