import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { BackupService } from './backup.service';

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

@Controller('admin/backup')
@UseGuards(JwtAuthGuard, AdminGuard)
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  list() {
    return this.backup.list();
  }

  @Post()
  create() {
    return this.backup.create();
  }

  @Get('download/:name')
  async download(@Param('name') name: string) {
    const file = await this.backup.open(name);
    return new StreamableFile(file.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${file.filename}"`,
      length: file.size,
    });
  }

  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = process.env.BACKUP_DIR?.trim() || join(process.cwd(), 'backups');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, _file, cb) => {
          cb(null, `upload-${Date.now()}.part`);
        },
      }),
    }),
  )
  restore(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('confirm') confirm?: string,
  ) {
    return this.backup.restore(file, confirm ?? '');
  }
}
