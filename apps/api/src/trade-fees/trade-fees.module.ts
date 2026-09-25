import { Module } from '@nestjs/common';
import { TradeFeesController } from './trade-fees.controller';
import { TradeFeesService } from './trade-fees.service';

@Module({
  controllers: [TradeFeesController],
  providers: [TradeFeesService],
  exports: [TradeFeesService],
})
export class TradeFeesModule {}
