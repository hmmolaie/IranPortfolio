import {
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import { FundsService } from './funds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class UploadMetaDto {
  @IsString()
  fundName!: string;

  @IsString()
  reportMonth!: string;
}

@Controller('funds')
@UseGuards(JwtAuthGuard)
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.funds.list(req.user.userId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: { user: { userId: string } },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadMetaDto,
  ) {
    return this.funds.uploadAndAnalyze(req.user.userId, file, body.fundName, body.reportMonth);
  }
}
