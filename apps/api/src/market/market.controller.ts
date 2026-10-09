import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { MarketService } from './market.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class AskDto {
  @IsString()
  @MinLength(2)
  question!: string;
}

class MarketChatDto {
  @IsString()
  @MinLength(2)
  @MaxLength(800)
  message!: string;
}

class SaveBrsApiDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  apiToken?: string;
}

@Controller('market')
@UseGuards(JwtAuthGuard)
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('quotes')
  list(
    @Query('q') q?: string,
    @Query('assetType') assetType?: AssetType,
    @Query('take') take?: string,
    @Query('page') page?: string,
  ) {
    return this.market.listLatest({
      q,
      assetType,
      take: take ? Number(take) : undefined,
      page: page ? Number(page) : undefined,
    });
  }

  @Get('option-board')
  optionBoard() {
    return this.market.getOptionBoard();
  }

  @Get('indices')
  indices(@Query('days') days?: string) {
    return this.market.getMarketIndices(days ? Number(days) : 60);
  }

  @Get('chat')
  getChat(@Req() req: { user: { userId: string } }) {
    return this.market.getChat(req.user.userId);
  }

  @Post('chat')
  postChat(
    @Req() req: { user: { userId: string; role?: string } },
    @Body() dto: MarketChatDto,
  ) {
    return this.market.postChat(req.user.userId, req.user.role ?? 'USER', dto.message);
  }

  @Delete('chat')
  hideChat(@Req() req: { user: { userId: string } }) {
    return this.market.hideChat(req.user.userId);
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
  ask(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: AskDto,
  ) {
    return this.market.askAboutInstrument(req.user.userId, id, dto.question);
  }

  @Post('ingest')
  @UseGuards(AdminGuard)
  ingest() {
    return this.market.ingestCatchUp();
  }

  @Get('brs-api')
  @UseGuards(AdminGuard)
  brsApi() {
    return this.market.getBrsApiConfig();
  }

  @Put('brs-api')
  @UseGuards(AdminGuard)
  saveBrsApi(@Body() dto: SaveBrsApiDto) {
    return this.market.saveBrsApiConfig(dto);
  }

  @Post('brs-api/test')
  @UseGuards(AdminGuard)
  testBrsApi() {
    return this.market.testBrsApi();
  }
}
