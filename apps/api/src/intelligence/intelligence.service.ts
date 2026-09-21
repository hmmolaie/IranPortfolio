import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateKey } from '../news/tehran-date';
import {
  CLASS_KEYS,
  ClassKey,
  LEVEL_FA,
  METHODOLOGY_FA,
  REGIME_LABEL_FA,
  RegimeCode,
  buildAlerts,
  buildDna,
  buildPlan,
  classifyRegime,
  fundShift,
  healthScore,
  maxDrawdownPct,
  pctChange,
  scenarioImpact,
  scoreRisk,
  weightsFromAmounts,
  Level,
} from './engine';

const LEVELS = new Set(['LOW', 'MEDIUM', 'HIGH']);

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

  async regimeBriefFa(): Promise<string> {
    const regime = await this.currentRegime(true);
    const lines = [`رژیم بازار: ${REGIME_LABEL_FA[regime.regime as RegimeCode] ?? regime.regime}`];
    if (!regime.enough) lines.push(regime.summaryFa);
    else {
      for (const d of regime.drivers.slice(0, 4)) lines.push(`- ${d.labelFa}`);
    }
    lines.push('این تشخیص قطعی نیست.');
    return lines.join('\n');
  }

  async currentRegime(persist: boolean) {
    const facts = await this.loadFacts();
    const classified = classifyRegime(facts);
    if (persist) {
      const dateKey = tehranDateKey();
      await this.prisma.marketRegimeLog.upsert({
        where: { dateKey },
        create: {
          dateKey,
          regime: classified.regime,
          confidence: classified.confidence,
          summaryFa: classified.summaryFa,
          drivers: classified.drivers as unknown as Prisma.InputJsonValue,
        },
        update: {
          regime: classified.regime,
          confidence: classified.confidence,
          summaryFa: classified.summaryFa,
          drivers: classified.drivers as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return { ...classified, facts, methodologyFa: METHODOLOGY_FA.regime, labelFa: REGIME_LABEL_FA[classified.regime] };
  }

  async rebalanceBriefFa(userId: string): Promise<string> {
    const home = await this.home(userId);
    if (!home.portfolio) return '';
    const lines = [`بازچینش محاسبه‌شده برای «${home.portfolio.name}»:`];
    const moves = home.portfolio.plan.slice(0, 3);
    if (!moves.length) lines.push('فاصلهٔ مهمی از وزن هدف، با دادهٔ موجود، دیده نشد.');
    else {
      for (const line of moves) {
        lines.push(
          `${line.labelFa}: ${line.currentPct.toLocaleString('fa-IR')}٪ → ${line.targetPct.toLocaleString('fa-IR')}٪`,
        );
      }
      if (moves[0]?.reasonFa) lines.push(moves[0].reasonFa);
    }
    lines.push('این متن معامله خودکار نیست و قطعیت ندارد.');
    return lines.join('\n');
  }

  async home(userId: string) {
    const regime = await this.currentRegime(true);
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true },
    });
    if (!portfolio) {
      return { regime, portfolio: null };
    }
    const detail = await this.portfolio(userId, portfolio.id, false);
    return {
      regime,
      portfolio: {
        id: portfolio.id,
        name: portfolio.name,
        health: detail.health,
        risk: detail.risk,
        plan: detail.plan.lines.filter((l) => l.action !== 'HOLD').slice(0, 3),
        alerts: detail.alerts,
      },
    };
  }

  async portfolio(userId: string, portfolioId: string, isAdmin: boolean) {
    const portfolio = await this.loadPortfolio(userId, portfolioId, isAdmin);
    const profile = await this.prisma.userProfile.findUnique({ where: { userId: portfolio.userId } });
    const facts = await this.loadFacts();
    const regime = classifyRegime(facts);
    const weights = await this.portfolioWeights(portfolio);
    const dna = buildDna({
      riskTolerance: profile?.riskTolerance ?? 5,
      horizonMonths: profile?.horizonMonths ?? 12,
      liquidityNeed: asLevel(profile?.liquidityNeed),
      maxDrawdownPct: profile?.maxDrawdownPct ?? null,
      inflationSensitivity: asLevel(profile?.inflationSensitivity),
      fxSensitivity: asLevel(profile?.fxSensitivity),
      weights,
    });
    const plan = buildPlan({
      riskTolerance: dna.riskScore,
      weights,
      regime: regime.regime,
      confidence: regime.confidence,
      drivers: regime.drivers,
    });
    const risk = scoreRisk(weights, facts.inflationPct != null);
    const drawdown = maxDrawdownPct(
      [...portfolio.snapshots].reverse().map((s) => Number(s.totalValueRial) || 0),
    );
    const health = healthScore(weights, risk.score);
    const alerts = buildAlerts({
      regime: regime.regime,
      enoughRegime: regime.enough,
      weights,
      lines: plan.lines,
    });
    const benchmark = this.benchmark(portfolio.snapshots, await this.spotSeries());
    const payload = {
      regime: regime.regime,
      labelFa: REGIME_LABEL_FA[regime.regime],
      confidence: regime.confidence,
      summaryFa: regime.summaryFa,
      drivers: regime.drivers,
      weights,
      plan: plan.lines,
      healthScore: health.score,
    };
    await this.prisma.intelligenceLog.upsert({
      where: { portfolioId_dateKey: { portfolioId: portfolio.id, dateKey: tehranDateKey() } },
      create: {
        userId: portfolio.userId,
        portfolioId: portfolio.id,
        dateKey: tehranDateKey(),
        regime: regime.regime,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      update: {
        regime: regime.regime,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      disclaimerFa: 'این خروجی توصیهٔ قطعی، پیش‌بینی تضمینی یا دستور معامله نیست.',
      methodology: METHODOLOGY_FA,
      dna: {
        ...dna,
        liquidityLabelFa: dna.liquidityNeed ? LEVEL_FA[dna.liquidityNeed] : null,
        inflationLabelFa: dna.inflationSensitivity ? LEVEL_FA[dna.inflationSensitivity] : null,
        fxSensitivityLabelFa: dna.fxSensitivity ? LEVEL_FA[dna.fxSensitivity] : null,
        fxExposureLabelFa: LEVEL_FA[dna.fxExposure],
      },
      regime: {
        ...regime,
        labelFa: REGIME_LABEL_FA[regime.regime],
        facts,
      },
      risk: { ...risk, drawdown },
      health,
      plan,
      alerts,
      benchmark,
    };
  }

  async history(userId: string, portfolioId: string, isAdmin: boolean) {
    await this.loadPortfolio(userId, portfolioId, isAdmin);
    const rows = await this.prisma.intelligenceLog.findMany({
      where: { portfolioId },
      orderBy: { dateKey: 'desc' },
      take: 30,
      select: { id: true, dateKey: true, regime: true, payload: true, createdAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      dateKey: row.dateKey,
      regime: row.regime,
      labelFa: REGIME_LABEL_FA[row.regime as RegimeCode] ?? row.regime,
      createdAt: row.createdAt,
      payload: row.payload,
    }));
  }

  scenario(weights: Record<ClassKey, number>, shocks: Partial<Record<ClassKey, number>>) {
    return scenarioImpact(weights, shocks);
  }

  async scenarioForPortfolio(
    userId: string,
    portfolioId: string,
    isAdmin: boolean,
    shocks: Partial<Record<ClassKey, number>>,
  ) {
    const portfolio = await this.loadPortfolio(userId, portfolioId, isAdmin);
    return scenarioImpact(await this.portfolioWeights(portfolio), shocks);
  }

  async dataHealth() {
    const today = tehranDateKey();
    const [prices, spots, macros, news, funds, world] = await Promise.all([
      this.prisma.priceBar.aggregate({ _count: true, _max: { tradeDate: true } }),
      this.prisma.spotPriceDaily.aggregate({ _count: true, _max: { dateKey: true } }),
      this.prisma.macroSnapshot.aggregate({ _count: true, _max: { asOfDate: true } }),
      this.prisma.economicNewsBatch.aggregate({ _count: true, _max: { newsDateKey: true } }),
      this.prisma.fundReport.aggregate({ _count: true, _max: { createdAt: true } }),
      this.prisma.worldMarketRefresh.aggregate({ _count: true, _max: { dateKey: true } }),
    ]);
    const row = (
      nameFa: string,
      count: number,
      last: string | null,
    ): { nameFa: string; count: number; last: string | null; status: 'ok' | 'warn' | 'empty' } => {
      if (!count || !last) return { nameFa, count, last, status: 'empty' };
      const age = last.slice(0, 10) === today || last.slice(0, 10) >= shiftDate(today, -3);
      return { nameFa, count, last, status: age ? 'ok' : 'warn' };
    };
    return {
      asOf: today,
      sources: [
        row('بازار سهام', prices._count, prices._max.tradeDate ? prices._max.tradeDate.toISOString().slice(0, 10) : null),
        row('دلار و طلا', spots._count, spots._max.dateKey ?? null),
        row('کلان ایران', macros._count, macros._max.asOfDate ? macros._max.asOfDate.toISOString().slice(0, 10) : null),
        row('اخبار', news._count, news._max.newsDateKey ?? null),
        row('گزارش صندوق', funds._count, funds._max.createdAt ? funds._max.createdAt.toISOString().slice(0, 10) : null),
        row('اقتصاد دنیا', world._count, world._max.dateKey ?? null),
      ],
    };
  }

  observeFund(periods: Array<{ label: string; weights: Partial<Record<ClassKey, number>> }>) {
    return fundShift(periods);
  }

  private async loadPortfolio(userId: string, portfolioId: string, isAdmin: boolean) {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { id: portfolioId },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        },
      },
    });
    if (!portfolio) throw new NotFoundException('سبد یافت نشد');
    if (!isAdmin && portfolio.userId !== userId) throw new ForbiddenException();
    return portfolio;
  }

  private async portfolioWeights(portfolio: {
    cashRial: number;
    snapshots: Array<{
      items: Array<{
        assetType: string;
        amountRial: number;
        quantity: number;
        instrumentId: string | null;
        unitPrice: number | null;
      }>;
    }>;
  }) {
    const latest = portfolio.snapshots[0];
    const items = latest?.items ?? [];
    const ids = [...new Set(items.map((item) => item.instrumentId).filter((id): id is string => !!id))];
    const live = new Map<string, number>();
    await Promise.all(
      ids.map(async (id) => {
        const bar = await this.prisma.priceBar.findFirst({
          where: { instrumentId: id },
          orderBy: { tradeDate: 'desc' },
          select: { lastPrice: true, closePrice: true },
        });
        const price = bar?.lastPrice ?? bar?.closePrice;
        if (price != null && price > 0) live.set(id, price);
      }),
    );
    const rows = items.map((item) => {
      const qty = Number(item.quantity) || 0;
      const market =
        item.instrumentId && live.has(item.instrumentId) && qty > 0
          ? (live.get(item.instrumentId) as number) * qty
          : item.unitPrice != null && item.unitPrice > 0 && qty > 0
            ? item.unitPrice * qty
            : Number(item.amountRial) || 0;
      return { assetType: item.assetType, amountRial: market };
    });
    if (!rows.some((r) => r.assetType === 'CASH') && portfolio.cashRial > 0) {
      rows.push({ assetType: 'CASH', amountRial: portfolio.cashRial });
    }
    return weightsFromAmounts(rows);
  }

  private async loadFacts() {
    const spots = await this.spotSeries();
    const macros = await this.prisma.macroSnapshot.findMany({ orderBy: { asOfDate: 'desc' }, take: 2 });
    const news = await this.prisma.economicNewsBatch.findFirst({
      orderBy: { createdAt: 'desc' },
      include: { items: { select: { impactDirection: true, category: true } } },
    });
    const latest = spots[spots.length - 1];
    const older = spots.length >= 2 ? spots[Math.max(0, spots.length - 8)] : null;
    const macro = macros[0];
    const prevMacro = macros[1];
    const items = (news?.items ?? []).filter((i) => i.category !== 'opportunity');
    return {
      usdChangePct: pctChange(older?.usdIrr, latest?.usdIrr),
      goldChangePct: pctChange(older?.goldGramRial, latest?.goldGramRial),
      interestRatePct: macro?.interestRatePct ?? null,
      interestRateChangePoints:
        macro?.interestRatePct != null && prevMacro?.interestRatePct != null
          ? Math.round((macro.interestRatePct - prevMacro.interestRatePct) * 100) / 100
          : null,
      inflationPct: macro?.inflationPct ?? null,
      geoRiskScore: macro?.geoRiskScore ?? null,
      newsBearish: items.filter((i) => i.impactDirection === 'bearish').length,
      newsBullish: items.filter((i) => i.impactDirection === 'bullish').length,
    };
  }

  private async spotSeries() {
    const rows = await this.prisma.spotPriceDaily.findMany({
      orderBy: { dateKey: 'desc' },
      take: 40,
      select: { dateKey: true, usdIrr: true, goldGramRial: true },
    });
    return rows.reverse();
  }

  private benchmark(
    snapshots: Array<{ createdAt: Date; totalValueRial: number | null }>,
    spots: Array<{ dateKey: string; usdIrr: number | null; goldGramRial: number | null }>,
  ) {
    const values = [...snapshots].reverse().map((s) => Number(s.totalValueRial) || 0).filter((n) => n > 0);
    const portfolioPct = values.length >= 2 ? pctChange(values[0], values[values.length - 1]) : null;
    const usdPct = spots.length >= 2 ? pctChange(spots[0].usdIrr, spots[spots.length - 1].usdIrr) : null;
    const goldPct = spots.length >= 2 ? pctChange(spots[0].goldGramRial, spots[spots.length - 1].goldGramRial) : null;
    if (portfolioPct == null && usdPct == null && goldPct == null) {
      return { enough: false, noteFa: 'داده برای مقایسه با دلار یا طلا کافی نیست.', portfolioPct: null, usdPct: null, goldPct: null };
    }
    return {
      enough: true,
      noteFa: 'مقایسه روی بازهٔ رکوردهای موجود است، نه لزوماً یک ماه یا یک سال کامل.',
      portfolioPct,
      usdPct,
      goldPct,
    };
  }
}

function asLevel(value: string | null | undefined): Level | null {
  if (value && LEVELS.has(value)) return value as Level;
  return null;
}

function shiftDate(dateKey: string, days: number) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export { CLASS_KEYS };
