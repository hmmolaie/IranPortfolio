import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  AssetType,
  PortfolioEventType,
  PortfolioStrategy,
  SnapshotKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  list(userId: string) {
    return this.prisma.portfolio.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { items: true },
        },
      },
    });
  }

  async get(userId: string, id: string) {
    const p = await this.prisma.portfolio.findUnique({
      where: { id },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        },
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!p) throw new NotFoundException('سبد یافت نشد');
    if (p.userId !== userId) throw new ForbiddenException();
    return p;
  }

  create(
    userId: string,
    data: { name: string; strategy: PortfolioStrategy; capitalRial: number; description?: string },
  ) {
    return this.prisma.portfolio.create({
      data: {
        userId,
        name: data.name,
        strategy: data.strategy,
        capitalRial: data.capitalRial,
        cashRial: data.capitalRial,
        description: data.description,
      },
    });
  }

  async suggest(userId: string, portfolioId: string) {
    const portfolio = await this.get(userId, portfolioId);
    const universe = await this.buildUniverse();
    const macro = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const funds = await this.prisma.fundReport.findMany({
      where: { userId, useInSuggestions: true },
      orderBy: { rating: 'desc' },
      take: 5,
    });
    const lessons = await this.prisma.lesson.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const system = `تو یک مشاور تخصیص دارایی برای بازار سرمایه ایران هستی.
پاسخ را فقط JSON معتبر برگردان.
خروجی دقیقاً این ساختار را داشته باشد:
{
  "strategySummaryFa": "متن فارسی خلاصه استراتژی",
  "items": [
    {
      "symbol": "نماد",
      "assetType": "STOCK|GOLD_ETF|OPTION|DEPOSIT|FUND|CASH",
      "weightPct": 10,
      "reasonFa": "دلیل فارسی انتخاب"
    }
  ]
}
قوانین: مجموع weightPct نزدیک ۱۰۰ باشد. از نمادهای موجود در جهان سرمایه‌گذاری استفاده کن.
سبد می‌تواند سهام، طلا، سپرده و اختیار فعال داشته باشد. شرایط اقتصاد ایران را در نظر بگیر.
این مشاوره رسمی نیست.`;

    const userPrompt = JSON.stringify(
      {
        capitalRial: portfolio.capitalRial,
        strategy: portfolio.strategy,
        cashRial: portfolio.cashRial,
        universe: universe.slice(0, 80),
        macro,
        topFunds: funds.map((f) => ({
          fundName: f.fundName,
          rating: f.rating,
          guessedStrategyFa: f.guessedStrategyFa,
        })),
        lessons: lessons.map((l) => ({ title: l.titleFa, body: l.bodyFa })),
      },
      null,
      2,
    );

    type LlmOut = {
      strategySummaryFa: string;
      items: Array<{
        symbol: string;
        assetType: AssetType;
        weightPct: number;
        reasonFa: string;
      }>;
    };

    let out: LlmOut;
    try {
      out = await this.llm.chatJson<LlmOut>('portfolio_suggest', system, userPrompt, userId);
    } catch {
      out = this.fallbackSuggest(universe, portfolio.strategy);
    }

    const items = this.materializeItems(out.items ?? [], portfolio.capitalRial, universe);
    const snapshot = await this.prisma.portfolioSnapshot.create({
      data: {
        portfolioId,
        kind: SnapshotKind.SUGGESTION,
        strategySummaryFa: out.strategySummaryFa ?? 'پیشنهاد سبد',
        totalValueRial: portfolio.capitalRial,
        items: {
          create: items,
        },
      },
      include: { items: true },
    });

    return snapshot;
  }

  async rebalance(userId: string, portfolioId: string, noteFa?: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    const snapshot = await this.suggest(userId, portfolioId);
    await this.prisma.portfolioSnapshot.update({
      where: { id: snapshot.id },
      data: {
        kind: SnapshotKind.REBALANCE,
        meta: { previousSnapshotId: latest?.id, noteFa },
      },
    });
    return this.prisma.portfolioSnapshot.findUnique({
      where: { id: snapshot.id },
      include: { items: true },
    });
  }

  async monthlyEvaluate(userId: string, portfolioId: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('ابتدا یک پیشنهاد سبد بسازید');

    const system = `عملکرد ماهانه سبد سرمایه‌گذاری ایران را ارزیابی کن و JSON برگردان:
{
  "performancePct": 1.5,
  "summaryFa": "خلاصه فارسی",
  "lessons": [{"titleFa":"...","bodyFa":"..."}]
}`;
    const prompt = JSON.stringify({
      portfolio: { name: portfolio.name, strategy: portfolio.strategy },
      latestItems: latest.items,
    });

    type EvalOut = {
      performancePct: number;
      summaryFa: string;
      lessons: Array<{ titleFa: string; bodyFa: string }>;
    };

    let evalOut: EvalOut;
    try {
      evalOut = await this.llm.chatJson<EvalOut>('monthly_eval', system, prompt, userId);
    } catch {
      evalOut = {
        performancePct: 0,
        summaryFa: 'ارزیابی خودکار بدون LLM: قیمت‌ها را با داده‌های روز مقایسه کنید.',
        lessons: [],
      };
    }

    for (const lesson of evalOut.lessons ?? []) {
      await this.prisma.lesson.create({
        data: {
          userId,
          titleFa: lesson.titleFa,
          bodyFa: lesson.bodyFa,
          source: 'monthly_eval',
        },
      });
    }

    const rebalanced = await this.rebalance(userId, portfolioId, evalOut.summaryFa);
    await this.prisma.portfolioSnapshot.update({
      where: { id: rebalanced!.id },
      data: {
        kind: SnapshotKind.MONTHLY_EVAL,
        performancePct: evalOut.performancePct,
        strategySummaryFa: evalOut.summaryFa,
      },
    });

    return this.prisma.portfolioSnapshot.findUnique({
      where: { id: rebalanced!.id },
      include: { items: true },
    });
  }

  async adjustWeights(
    userId: string,
    portfolioId: string,
    items: Array<{ symbol: string; weightPct: number; quantity?: number }>,
  ) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('نسخه‌ای برای ویرایش نیست');

    const universe = await this.buildUniverse();
    const mapped = items.map((i) => {
      const prev = latest.items.find((x) => x.symbol === i.symbol);
      const u = universe.find((x) => x.symbol === i.symbol);
      const price = u?.lastPrice ?? prev?.unitPrice ?? 1;
      const weightPct = i.weightPct;
      const amountRial = (weightPct / 100) * portfolio.capitalRial;
      const quantity = i.quantity ?? (price ? amountRial / price : 0);
      return {
        symbol: i.symbol,
        assetType: prev?.assetType ?? u?.assetType ?? AssetType.STOCK,
        weightPct,
        quantity,
        amountRial,
        unitPrice: price,
        reasonFa: prev?.reasonFa ?? 'ویرایش دستی کاربر',
        instrumentId: u?.id,
      };
    });

    const snapshot = await this.prisma.portfolioSnapshot.create({
      data: {
        portfolioId,
        kind: SnapshotKind.USER_ADJUSTED,
        strategySummaryFa: latest.strategySummaryFa,
        totalValueRial: portfolio.capitalRial,
        items: { create: mapped },
        meta: { basedOn: latest.id },
      },
      include: { items: true },
    });

    await this.prisma.portfolioEvent.create({
      data: {
        portfolioId,
        type: PortfolioEventType.WEIGHT_EDIT,
        payload: { items },
        noteFa: 'ویرایش وزن/مقدار توسط کاربر',
      },
    });

    return snapshot;
  }

  async cashEvent(
    userId: string,
    portfolioId: string,
    type: 'DEPOSIT_CASH' | 'WITHDRAW_CASH' | 'SELL',
    amountRial: number,
    symbol?: string,
  ) {
    const portfolio = await this.get(userId, portfolioId);
    let cash = portfolio.cashRial;
    let capital = portfolio.capitalRial;

    if (type === 'DEPOSIT_CASH') {
      cash += amountRial;
      capital += amountRial;
    } else if (type === 'WITHDRAW_CASH') {
      cash = Math.max(0, cash - amountRial);
      capital = Math.max(0, capital - amountRial);
    } else if (type === 'SELL') {
      cash += amountRial;
    }

    await this.prisma.portfolio.update({
      where: { id: portfolioId },
      data: { cashRial: cash, capitalRial: capital },
    });

    await this.prisma.portfolioEvent.create({
      data: {
        portfolioId,
        type: type as PortfolioEventType,
        payload: { amountRial, symbol },
        noteFa:
          type === 'DEPOSIT_CASH'
            ? 'واریز نقد'
            : type === 'WITHDRAW_CASH'
              ? 'برداشت نقد'
              : `فروش ${symbol ?? ''}`,
      },
    });

    return this.rebalance(userId, portfolioId, 'بازچینش پس از تغییر نقد/فروش');
  }

  private materializeItems(
    items: Array<{ symbol: string; assetType: AssetType; weightPct: number; reasonFa: string }>,
    capital: number,
    universe: Array<{ id: string; symbol: string; assetType: AssetType; lastPrice: number | null }>,
  ) {
    const total = items.reduce((s, i) => s + (i.weightPct || 0), 0) || 100;
    return items.map((i) => {
      const weightPct = (i.weightPct / total) * 100;
      const amountRial = (weightPct / 100) * capital;
      const u = universe.find((x) => x.symbol === i.symbol);
      const unitPrice = u?.lastPrice ?? 1;
      const quantity = unitPrice ? amountRial / unitPrice : 0;
      return {
        symbol: i.symbol,
        assetType: i.assetType ?? u?.assetType ?? AssetType.STOCK,
        weightPct,
        quantity,
        amountRial,
        unitPrice,
        reasonFa: i.reasonFa || 'انتخاب بر اساس استراتژی',
        instrumentId: u?.id,
      };
    });
  }

  private fallbackSuggest(
    universe: Array<{ symbol: string; assetType: AssetType; lastPrice: number | null; pe: number | null }>,
    strategy: PortfolioStrategy,
  ) {
    const stocks = universe.filter((u) => u.assetType === AssetType.STOCK).slice(0, 5);
    const gold = universe.find((u) => u.assetType === AssetType.GOLD_ETF);
    const deposit = universe.find((u) => u.assetType === AssetType.DEPOSIT);
    const items: Array<{
      symbol: string;
      assetType: AssetType;
      weightPct: number;
      reasonFa: string;
    }> = [];

    const stockWeight = strategy === PortfolioStrategy.CONSERVATIVE ? 40 : 60;
    const each = stocks.length ? stockWeight / stocks.length : 0;
    for (const s of stocks) {
      items.push({
        symbol: s.symbol,
        assetType: AssetType.STOCK,
        weightPct: each,
        reasonFa: `انتخاب پیش‌فرض برای استراتژی ${strategy} (بدون LLM)`,
      });
    }
    if (gold) {
      items.push({
        symbol: gold.symbol,
        assetType: AssetType.GOLD_ETF,
        weightPct: 20,
        reasonFa: 'پوشش تورمی با صندوق طلا',
      });
    }
    if (deposit) {
      items.push({
        symbol: deposit.symbol,
        assetType: AssetType.DEPOSIT,
        weightPct: 20,
        reasonFa: 'بخش امن نقدشونده با سپرده بانکی',
      });
    }
    return {
      strategySummaryFa: 'پیشنهاد قاعده‌محور بدون دسترسی به LLM',
      items,
    };
  }

  private async buildUniverse() {
    const instruments = await this.prisma.instrument.findMany({
      where: { isActive: true },
      take: 200,
      include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 1 } },
    });
    return instruments.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      nameFa: i.nameFa,
      assetType: i.assetType,
      lastPrice: i.priceBars[0]?.lastPrice ?? i.priceBars[0]?.closePrice ?? null,
      eps: i.priceBars[0]?.eps ?? null,
      pe: i.priceBars[0]?.pe ?? null,
    }));
  }
}
