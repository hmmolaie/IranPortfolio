import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { IsString, MinLength } from 'class-validator';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class AskDto {
  @IsString()
  @MinLength(2)
  question!: string;
}

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('quotes')
  list(
    @Query('q') q?: string,
    @Query('assetType') assetType?: AssetType,
    @Query('take') take?: string,
  ) {
    return this.market.listLatest({
      q,
      assetType,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('instruments/:id/history')
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.market.getPriceHistory(id, limit ? Number(limit) : 90);
  }

  @Get('instruments/:id')
  async detail(@Param('id') id: string) {
    const inst = await this.market.getInstrument(id);
    if (!inst) throw new NotFoundException('نماد یافت نشد');
    return inst;
  }

  @Post('instruments/:id/ask')
  @UseGuards(JwtAuthGuard)
  ask(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: AskDto,
  ) {
    return this.market.askAboutInstrument(req.user.userId, id, dto.question);
  }

  @Post('ingest')
  @UseGuards(JwtAuthGuard, AdminGuard)
  ingest() {
    return this.market.ingestCatchUp();
  }
}
