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
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { FundsService } from './funds.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class CreateFundDefinitionDto {
  @IsString()
  nameFa!: string;

  @IsOptional()
  @IsString()
  symbolCode?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class UploadMetaDto {
  @IsString()
  fundDefinitionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1300)
  @Max(1500)
  reportYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  reportMonthNum!: number;
}

@Controller('funds')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FundsController {
  constructor(private readonly funds: FundsService) {}

  @Get('definitions')
  listDefinitions(@Req() req: { user: { userId: string } }) {
    return this.funds.listDefinitions(req.user.userId);
  }

  @Post('definitions')
  createDefinition(
    @Req() req: { user: { userId: string } },
    @Body() body: CreateFundDefinitionDto,
  ) {
    return this.funds.createDefinition(req.user.userId, body);
  }

  @Delete('definitions/:id')
  removeDefinition(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.funds.removeDefinition(req.user.userId, id);
  }

  @Get('timeline/:fundDefinitionId')
  timeline(
    @Req() req: { user: { userId: string } },
    @Param('fundDefinitionId') fundDefinitionId: string,
  ) {
    return this.funds.getTimeline(req.user.userId, fundDefinitionId);
  }

  @Post('timeline/:fundDefinitionId/analyze')
  analyzeTimeline(
    @Req() req: { user: { userId: string } },
    @Param('fundDefinitionId') fundDefinitionId: string,
  ) {
    return this.funds.analyzeTimeline(req.user.userId, fundDefinitionId);
  }

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
    return this.funds.uploadAndAnalyze(
      req.user.userId,
      file,
      body.fundDefinitionId,
      body.reportYear,
      body.reportMonthNum,
    );
  }

  @Delete(':id')
  remove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.funds.remove(req.user.userId, id);
  }
}
