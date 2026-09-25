import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { clampFeePct, TradeFeeRates, ZERO_TRADE_FEES } from './trade-fees';

@Injectable()
export class TradeFeesService {
  constructor(private readonly prisma: PrismaService) {}

  async read(): Promise<TradeFeeRates> {
    const row = await this.prisma.tradeFeeConfig.findUnique({ where: { id: 'default' } });
    if (!row) return { ...ZERO_TRADE_FEES };
    return {
      stockBuyPct: row.stockBuyPct,
      stockSellPct: row.stockSellPct,
      physicalUsdBuyPct: row.physicalUsdBuyPct,
      physicalUsdSellPct: row.physicalUsdSellPct,
      physicalGoldBuyPct: row.physicalGoldBuyPct,
      physicalGoldSellPct: row.physicalGoldSellPct,
    };
  }

  async save(input: TradeFeeRates): Promise<TradeFeeRates> {
    const data = {
      stockBuyPct: clampFeePct(input.stockBuyPct),
      stockSellPct: clampFeePct(input.stockSellPct),
      physicalUsdBuyPct: clampFeePct(input.physicalUsdBuyPct),
      physicalUsdSellPct: clampFeePct(input.physicalUsdSellPct),
      physicalGoldBuyPct: clampFeePct(input.physicalGoldBuyPct),
      physicalGoldSellPct: clampFeePct(input.physicalGoldSellPct),
    };
    await this.prisma.tradeFeeConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    return data;
  }
}
