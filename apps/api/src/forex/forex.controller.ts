import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ForexService } from './forex.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('forex')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ForexController {
  constructor(private readonly forex: ForexService) {}

  @Get()
  latest() {
    return this.forex.latest();
  }

  @Get('snapshots')
  snapshots() {
    return this.forex.listSnapshots();
  }

  @Get('snapshots/:id')
  snapshot(@Param('id') id: string) {
    return this.forex.getSnapshot(id);
  }

  @Post('refresh')
  refresh() {
    return this.forex.refresh();
  }
}
