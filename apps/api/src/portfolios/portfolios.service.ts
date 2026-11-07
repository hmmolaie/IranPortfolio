import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AssetType,
  PortfolioEventType,
  PortfolioStrategy,
  Prisma,
  SnapshotKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiQuotaExceededException } from '../ai-usage/ai-usage.service';
import { isLlmGatewayFailure, LlmService } from '../llm/llm.service';
import { NewsService } from '../news/news.service';
import { UsersService } from '../users/users.service';
import { WorldMarketsService } from '../world-markets/world-markets.service';
import { WalletService } from '../wallet/wallet.service';
import { TradeFeesService } from '../trade-fees/trade-fees.service';
import {
  feeInstructionFa,
  holdingFeeRial,
  suggestionClearsFees,
} from '../trade-fees/trade-fees';
import { daysAgoDateKey } from '../news/tehran-date';
import { foldFa, tokenizeMarketQuestion } from '../market/tehran-chat';
import { visibleInstrumentsWhere, MarketService } from '../market/market.service';
import {
  detectQueue,
  optionBelongsToUnderlying,
  optionBoardForPrompt,
  optionExpired,
  optionMetaExpired,
  parseOptionMeta,
  redirectAnalysisSuggestion,
} from '../market/option-board';
import {
  CLASS_LABEL_FA,
  type ClassId,
  type InvestorState,
  type MarketState,
  type HedgeCandidate,
  type StockFact,
  SCREEN_SHORTLIST,
  SIZE_LEVELS,
  STOCKS_PER_CALL,
  allocationState,
  buildStockFact,
  classQuestions,
  faPct,
  fillHedge,
  fillStockSleeve,
  hedgeQuestions,
  hedgeState,
  normalizeClassWeights,
  readLevelPct,
  readNoul,
  stockQuestions,
  stockSignalsFa,
  stockState,
} from './suggest-system-one';
import { attachStockSignals } from './stock-signals';
import { StockScreenService } from './stock-screen.service';

type PortfolioNewsRow = {
  batch: { newsDateKey: string };
  titleFa: string;
  summaryFa: string;
  marketImpactFa: string | null;
  impactDirection: string | null;
  relevanceScore: number | null;
  sectorsFa: string | null;
  category: string | null;
  opportunityKind: string | null;
  participateHowFa: string | null;
  deadlineFa: string | null;
  officialSourceFa: string | null;
  isRetailActionable: boolean | null;
  xSourceHintFa: string | null;
};

function clipText(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function compactProfile(profile: {
  riskTolerance?: number;
  horizonMonths?: number;
  investmentPreferencesFa?: string | null;
  constraintsFa?: string | null;
  objectiveFa?: string | null;
  liquidityNeed?: string | null;
  maxDrawdownPct?: number | null;
  inflationSensitivity?: string | null;
  fxSensitivity?: string | null;
} | null) {
  if (!profile) return null;
  return {
    riskTolerance: profile.riskTolerance,
    horizonMonths: profile.horizonMonths,
    preferencesFa: clipText(profile.investmentPreferencesFa, 400),
    constraintsFa: clipText(profile.constraintsFa, 300),
    objectiveFa: clipText(profile.objectiveFa, 240),
    liquidityNeed: profile.liquidityNeed ?? null,
    maxDrawdownPct: profile.maxDrawdownPct ?? null,
    inflationSensitivity: profile.inflationSensitivity ?? null,
    fxSensitivity: profile.fxSensitivity ?? null,
  };
}

function splitNewsForPortfolio(rows: PortfolioNewsRow[]) {
  const isOpp = (n: PortfolioNewsRow) => n.category === 'opportunity' || Boolean(n.isRetailActionable);
  const base = (n: PortfolioNewsRow) => ({
    date: n.batch.newsDateKey,
    title: n.titleFa,
    summary: n.summaryFa,
    marketImpact: n.marketImpactFa,
    direction: n.impactDirection,
    relevance: n.relevanceScore,
    sectors: n.sectorsFa,
    xSource: n.xSourceHintFa,
    category: n.category,
  });
  return {
    economicNews: rows.filter((n) => !isOpp(n)).slice(0, 7).map(base),
    investmentOpportunities: rows.filter(isOpp).slice(0, 3).map((n) => ({
      ...base(n),
      opportunityKind: n.opportunityKind,
      participateHow: n.participateHowFa,
      deadline: n.deadlineFa,
      officialSource: n.officialSourceFa,
      isRetailActionable: n.isRetailActionable,
    })),
  };
}

@Injectable()
export class PortfoliosService {
  private readonly logger = new Logger(PortfoliosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly news: NewsService,
    private readonly users: UsersService,
    private readonly worldMarkets: WorldMarketsService,
    private readonly wallet: WalletService,
    private readonly tradeFees: TradeFeesService,
    private readonly market: MarketService,
    private readonly screen: StockScreenService,
  ) {}

  /** بعد از اینجست شبانه، غربال روزانهٔ سهم‌ها یک‌بار ساخته می‌شود تا پیشنهاد کاربر منتظر کل بازار نماند. */
  @Cron('*/10 * * * *', { timeZone: 'Asia/Tehran', name: 'stock-screen-prewarm' })
  async prewarmStockScreen() {
    try {
      const snapshot = await this.tradableSnapshot(AssetType.STOCK);
      if (!snapshot.tradeDate || !snapshot.rows.length) return;
      if (await this.screen.has(snapshot.tradeDate)) return;
      if (!this.screen.canRetry(snapshot.tradeDate)) return;
      if (!(await this.screen.ingestSettled(snapshot.tradeDate))) return;
      const adminId = await this.users.getAdminUserId();
      if (!adminId) return;
      await this.screen.run(snapshot.tradeDate, snapshot.rows, await this.decisionMarket(adminId));
      await this.screen.prune();
    } catch (e) {
      this.logger.warn(`غربال روزانهٔ سهام: ${(e as Error).message.slice(0, 300)}`);
    }
  }

  /**
   * سهم‌های برتر غربال روزانه با ارقام همین امروز. اگر غربالی در هفت روز اخیر نباشد همان لحظه ساخته می‌شود.
   * سهم صف‌شدهٔ امروز در فهرست نمی‌آید حتی اگر دیروز امتیاز بالا گرفته باشد.
   */
  private async stockShortlist(market: MarketState): Promise<StockFact[]> {
    const snapshot = await this.tradableSnapshot(AssetType.STOCK);
    if (!snapshot.tradeDate || !snapshot.rows.length) return [];
    const screen =
      (await this.screen.latest(snapshot.tradeDate)) ??
      (await this.screen.run(snapshot.tradeDate, snapshot.rows.map((row) => ({ ...row })), market));
    const shortlist = snapshot.rows
      .filter((row) => screen.scores.has(row.symbol))
      .sort((a, b) => (screen.scores.get(b.symbol) ?? 0) - (screen.scores.get(a.symbol) ?? 0))
      .slice(0, SCREEN_SHORTLIST);
    await attachStockSignals(this.prisma, shortlist, snapshot.tradeDate);
    for (const row of shortlist) row.sp = Math.round((screen.scores.get(row.symbol) ?? 0) * 100);
    return shortlist;
  }

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

  async get(userId: string, id: string, isAdmin = false) {
    const p = await this.prisma.portfolio.findUnique({
      where: { id },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        },
        events: {
          where: { status: 'active' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!p) throw new NotFoundException('سبد یافت نشد');
    if (!isAdmin && p.userId !== userId) throw new ForbiddenException();
    return this.enrichPortfolioMarketFields(p);
  }

  /** آخرین قیمت بازار + میانگین خرید + سود/زیان برای نمایش جدول سبد */
  private async enrichPortfolioMarketFields<
    T extends {
      snapshots: Array<{
        items: Array<{
          symbol: string;
          quantity: number;
          amountRial: number;
          unitPrice: number | null;
          avgBuyPrice?: number | null;
          assetType?: string;
        }>;
      }>;
    },
  >(portfolio: T) {
    const fees = await this.tradeFees.read();
    const universe = await this.buildUniverse();
    const lastBySymbol = new Map(
      universe.map((u) => [u.symbol.trim(), u.lastPrice] as const),
    );
    const optionSymbols = [
      ...new Set(
        portfolio.snapshots.flatMap((snap) =>
          snap.items
            .filter((item) => item.assetType === AssetType.OPTION)
            .map((item) => item.symbol.trim())
            .filter(Boolean),
        ),
      ),
    ];
    const expiredOptions = new Set(
      optionSymbols.length
        ? (
            await this.prisma.instrument.findMany({
              where: {
                assetType: AssetType.OPTION,
                symbol: { in: optionSymbols },
              },
              select: { symbol: true, nameFa: true, meta: true, assetType: true },
            })
          )
            .filter((row) => optionMetaExpired(row.meta, row.assetType, { nameFa: row.nameFa, symbol: row.symbol }))
            .map((row) => row.symbol.trim())
        : [],
    );

    return {
      ...portfolio,
      snapshots: portfolio.snapshots.map((snap) => ({
        ...snap,
        items: snap.items
          .filter((item) => !(item.assetType === AssetType.OPTION && expiredOptions.has(item.symbol.trim())))
          .map((item) => {
          const lastPrice =
            lastBySymbol.get(item.symbol.trim()) ??
            (item.unitPrice != null && item.unitPrice > 0 ? item.unitPrice : null);
          const avgBuyPrice =
            item.avgBuyPrice != null && item.avgBuyPrice > 0
              ? item.avgBuyPrice
              : item.unitPrice != null && item.unitPrice > 0
                ? item.unitPrice
                : lastPrice;
          const qty = Number(item.quantity) || 0;
          const costBasisRial =
            avgBuyPrice != null && qty > 0 ? avgBuyPrice * qty : Number(item.amountRial) || 0;
          const marketValueRial =
            lastPrice != null && qty > 0 ? lastPrice * qty : Number(item.amountRial) || 0;
          const grossPnl =
            avgBuyPrice != null && lastPrice != null ? (lastPrice - avgBuyPrice) * qty : null;
          const feeRial =
            grossPnl == null
              ? 0
              : Math.round(holdingFeeRial(fees, item.assetType, costBasisRial, marketValueRial));
          const pnlRial = grossPnl == null ? 0 : Math.round(grossPnl - feeRial);

          return {
            ...item,
            avgBuyPrice,
            lastPrice,
            costBasisRial,
            marketValueRial,
            feeRial,
            pnlRial,
            amountRial: Number(item.amountRial) || 0,
          };
        }),
      })),
    };
  }

  async create(
    userId: string,
    data: { name: string; strategy: PortfolioStrategy; capitalRial: number; description?: string },
  ) {
    const ai = await this.users.aiAccess(userId);
    if (ai.portfolio) await this.wallet.ensure(userId, 'suggest');
    const portfolio = await this.prisma.portfolio.create({
      data: {
        userId,
        name: data.name,
        strategy: data.strategy,
        capitalRial: data.capitalRial,
        cashRial: data.capitalRial,
        description: data.description,
      },
    });

    try {
      if (ai.portfolio) await this.suggest(userId, portfolio.id, { initialCreate: true });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      /* سبد خالی برمی‌گردد؛ کاربر بعداً می‌تواند پیشنهاد بگیرد */
    }

    return this.get(userId, portfolio.id);
  }

  async remove(userId: string, id: string, isAdmin = false) {
    await this.get(userId, id, isAdmin);
    await this.prisma.portfolio.delete({ where: { id } });
    return { ok: true };
  }

  async suggest(
    userId: string,
    portfolioId: string,
    options?: { initialCreate?: boolean; skipBilling?: boolean },
  ) {
    const charged = options?.skipBilling ? 0 : await this.wallet.charge(userId, 'suggest');
    try {
      const strategies = await this.suggestStrategies(userId, portfolioId, {
        ...options,
        skipBilling: true,
      });
      const first = strategies.strategies[0];
      if (!first) {
        return await this.createSnapshotFromItems(userId, portfolioId, {
          strategySummaryFa: 'پیشنهاد خالی',
          items: [],
        });
      }
      return await this.createSnapshotFromItems(userId, portfolioId, first);
    } catch (e) {
      await this.wallet.refund(userId, charged, 'suggest');
      throw e;
    }
  }

  async suggestHedge(userId: string, portfolioId: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new BadRequestException('برای پوشش ریسک ابتدا باید سبد تشکیل شده باشد.');
    const prepared = await this.livePutsForHoldings(latest.items);
    if (!prepared.candidates.length) {
      return {
        noteFa: prepared.held
          ? 'برای سهم‌های فعلی سبد، اختیار فروش سررسیدنشده و بدون صف پیدا نشد.'
          : 'سهمی در سبد نیست.',
        items: [],
        uncovered: prepared.uncovered,
      };
    }
    const charged = await this.wallet.charge(userId, 'suggest');
    try {
      const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
      const investor = this.investorState(portfolio, profile);
      const market = await this.decisionMarket(userId);
      const picks: Array<HedgeCandidate & { noul: number; sizePct: number }> = [];
      for (let offset = 0; offset < prepared.candidates.length; offset += STOCKS_PER_CALL) {
        const batch = prepared.candidates.slice(offset, offset + STOCKS_PER_CALL);
        const answers = await this.llm.systemOne(
          userId,
          'portfolio_hedge',
          hedgeState(investor, market, batch),
          hedgeQuestions(batch),
        );
        batch.forEach((option, index) => {
          picks.push({
            ...option,
            noul: readNoul(answers[`p${index}`]),
            sizePct: readLevelPct(answers[`s${index}`], SIZE_LEVELS),
          });
        });
      }
      const items = fillHedge(picks);
      return {
        noteFa: items.length
          ? 'این اختیارها فقط برای پوشش سهم‌های موجود پیشنهاد شده‌اند و به سبد اضافه نمی‌شوند.'
          : 'اختیارهای سررسیدنشده بررسی شدند، ولی اندازه یا احتمال هیچ‌کدام برای یک قرارداد کامل کافی نبود.',
        items,
        uncovered: prepared.uncovered,
      };
    } catch (e) {
      await this.wallet.refund(userId, charged, 'suggest');
      throw e;
    }
  }

  private async livePutsForHoldings(
    items: Array<{
      symbol: string;
      assetType: string;
      quantity: number;
      lastPrice?: number | null;
      unitPrice?: number | null;
    }>,
  ) {
    const held = items.filter((item) => item.assetType === AssetType.STOCK && item.quantity > 0);
    if (!held.length) return { held: false, candidates: [] as HedgeCandidate[], uncovered: [] as string[] };
    const symbols = [...new Set(held.map((item) => item.symbol))];
    const underlyings = await this.prisma.instrument.findMany({
      where: { isActive: true, assetType: AssetType.STOCK, symbol: { in: symbols } },
      select: { symbol: true, insCode: true },
    });
    const insBySymbol = new Map(underlyings.map((row) => [row.symbol, row.insCode]));
    const options = await this.prisma.instrument.findMany({
      where: { isActive: true, assetType: AssetType.OPTION },
      select: {
        id: true,
        symbol: true,
        nameFa: true,
        meta: true,
        priceBars: {
          orderBy: { tradeDate: 'desc' },
          take: 1,
          select: { lastPrice: true, closePrice: true, volume: true, raw: true },
        },
      },
    });
    const optionRows = options.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      nameFa: row.nameFa,
      assetType: AssetType.OPTION,
      lastPrice: row.priceBars[0]?.lastPrice ?? null,
      closePrice: row.priceBars[0]?.closePrice ?? null,
      volume: row.priceBars[0]?.volume ?? null,
      raw: row.priceBars[0]?.raw ?? null,
      meta: row.meta,
    }));
    const candidates: HedgeCandidate[] = [];
    const uncovered: string[] = [];
    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    for (const stock of held) {
      const spot = stock.lastPrice != null && stock.lastPrice > 0 ? stock.lastPrice : stock.unitPrice;
      if (spot == null || !(spot > 0)) {
        uncovered.push(stock.symbol);
        continue;
      }
      let added = 0;
      for (const row of optionRows) {
        if (!optionBelongsToUnderlying(stock.symbol, insBySymbol.get(stock.symbol), row)) continue;
        const parsed = parseOptionMeta({ ...asRecord(row.raw), ...asRecord(row.meta) }, row.symbol, row.nameFa);
        if (parsed.side !== 'PUT') continue;
        if (parsed.strike == null || !(parsed.strike > 0)) continue;
        if (parsed.daysLeft == null || !(parsed.daysLeft > 0) || optionExpired(parsed.daysLeft)) continue;
        if (optionMetaExpired(row.meta, AssetType.OPTION, { nameFa: row.nameFa, symbol: row.symbol })) continue;
        const premium = row.lastPrice != null && row.lastPrice > 0 ? row.lastPrice : row.closePrice;
        if (premium == null || !(premium > 0)) continue;
        if (row.volume != null && !(row.volume > 0)) continue;
        if (detectQueue(row.raw, premium)) continue;
        candidates.push({
          symbol: row.symbol,
          nameFa: row.nameFa,
          underlying: stock.symbol,
          strike: parsed.strike,
          premium,
          daysLeft: parsed.daysLeft,
          contractSize: parsed.contractSize != null && parsed.contractSize > 0 ? parsed.contractSize : 1,
          volume: row.volume,
          spot,
          heldQty: stock.quantity,
        });
        added += 1;
      }
      if (!added) uncovered.push(stock.symbol);
    }
    return { held: true, candidates, uncovered };
  }

  async suggestStrategies(
    userId: string,
    portfolioId: string,
    options?: { initialCreate?: boolean; skipBilling?: boolean },
  ) {
    const charged = options?.skipBilling ? 0 : await this.wallet.charge(userId, 'suggest');
    try {
      return await this.buildStrategySuggestions(userId, portfolioId, options);
    } catch (e) {
      await this.wallet.refund(userId, charged, 'suggest');
      throw e;
    }
  }

  private async buildStrategySuggestions(
    userId: string,
    portfolioId: string,
    _options?: { initialCreate?: boolean; skipBilling?: boolean },
  ) {
    const portfolio = await this.get(userId, portfolioId);
    if (!(portfolio.capitalRial > 0)) {
      throw new BadRequestException('سرمایهٔ سبد برای پیشنهاد کافی نیست.');
    }
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const investor = this.investorState(portfolio, profile);
    const market = await this.decisionMarket(userId);
    const classAnswers = await this.llm.systemOne(
      userId,
      'portfolio_suggest_multi',
      allocationState(investor, market),
      classQuestions(),
    );
    const weights = normalizeClassWeights(classAnswers);
    const stocks = weights.stock > 0 ? await this.stockShortlist(market) : [];
    const picks: Array<{
      symbol: string;
      nameFa: string;
      price: number;
      noul: number;
      sizePct: number;
      whyFa: string;
    }> = [];
    for (let offset = 0; offset < stocks.length; offset += STOCKS_PER_CALL) {
      const batch = stocks.slice(offset, offset + STOCKS_PER_CALL);
      const answers = await this.llm.systemOne(
        userId,
        'portfolio_suggest_multi',
        stockState(investor, market, batch),
        stockQuestions(batch),
      );
      batch.forEach((stock, index) => {
        picks.push({
          symbol: stock.symbol,
          nameFa: stock.nameFa,
          price: stock.price,
          noul: readNoul(answers[`p${index}`]),
          sizePct: readLevelPct(answers[`s${index}`], SIZE_LEVELS),
          whyFa: stockSignalsFa(stock),
        });
      });
    }

    const capital = portfolio.capitalRial;
    const stockItems = fillStockSleeve(capital, (capital * weights.stock) / 100, picks);
    const goldEtf = weights.gold_etf > 0 ? await this.busiestTradable(AssetType.GOLD_ETF) : null;
    const fund = weights.fund > 0 ? await this.busiestTradable(AssetType.FUND) : null;
    const items: Array<{
      symbol: string;
      assetType: AssetType;
      weightPct: number;
      reasonFa: string;
    }> = [];
    const pushClass = (id: ClassId, symbol: string, assetType: AssetType, reasonFa: string) => {
      if (weights[id] <= 0) return;
      items.push({ symbol, assetType, weightPct: weights[id], reasonFa });
    };
    pushClass('deposit', 'سپرده', AssetType.DEPOSIT, 'سهم سپرده از سرمایه، بعد از نرمال‌سازی امتیاز کلاس‌ها.');
    pushClass('physical_gold', 'PHYSICAL_GOLD', AssetType.PHYSICAL_GOLD, 'سهم طلای فیزیکی از سرمایه، بعد از نرمال‌سازی امتیاز کلاس‌ها.');
    pushClass('physical_usd', 'PHYSICAL_USD', AssetType.PHYSICAL_USD, 'سهم دلار فیزیکی از سرمایه، بعد از نرمال‌سازی امتیاز کلاس‌ها.');
    if (goldEtf) {
      pushClass(
        'gold_etf',
        goldEtf.symbol,
        AssetType.GOLD_ETF,
        'پرمعامله‌ترین صندوق طلای بدون صف برای همان درصد کلاس صندوق طلا.',
      );
    }
    if (fund) {
      pushClass(
        'fund',
        fund.symbol,
        AssetType.FUND,
        'پرمعامله‌ترین صندوق بدون صف برای همان درصد کلاس صندوق.',
      );
    }
    for (const stock of stockItems) {
      items.push({
        symbol: stock.symbol,
        assetType: AssetType.STOCK,
        weightPct: stock.weightPct,
        reasonFa: stock.reasonFa,
      });
    }
    const used = items.reduce((sum, item) => sum + item.weightPct, 0);
    const cashPct = Math.max(0, 100 - used);
    if (cashPct > 0.05) {
      items.push({
        symbol: 'CASH',
        assetType: AssetType.CASH,
        weightPct: cashPct,
        reasonFa:
          'نقدِ خودِ کلاس نقد، به‌علاوه ماندهٔ سهامی که احتمالش به ۵۰٪ نرسید یا یک واحدش از بودجه گران‌تر بود.',
      });
    }
    const mix = (Object.keys(weights) as ClassId[])
      .map((id) => `${CLASS_LABEL_FA[id]} ${faPct(weights[id])}٪`)
      .join('، ');
    return {
      strategies: [
        {
          labelFa: 'پیشنهاد System One',
          strategySummaryFa: `استراتژی ${investor.strategyFa}. تخصیص: ${mix}. سهم‌ها از آخرین معاملات بدون صف و با احتمال دست‌کم ۵۰٪ آمده‌اند. آخرین قیمت، EPS، نسبت سود به قیمت و ارقام موجود نماد، به‌همراه طلا، دلار، درس‌آموخته‌ها و اخبار در انتخاب سهم لحاظ شده‌اند. این خروجی تصمیم‌یار است.`,
          items,
        },
      ],
    };
  }

  private investorState(
    portfolio: { strategy: string; capitalRial: number; preferencesNoteFa: string | null },
    profile: {
      riskTolerance: number;
      horizonMonths: number;
      investmentPreferencesFa: string | null;
      constraintsFa: string | null;
      objectiveFa: string | null;
      notes: string | null;
      liquidityNeed: string | null;
      maxDrawdownPct: number | null;
      inflationSensitivity: string | null;
      fxSensitivity: string | null;
    } | null,
  ): InvestorState {
    const strategyFa: Record<string, string> = {
      GROWTH: 'رشدی',
      VALUE: 'ارزشی',
      INCOME: 'درآمدی',
      HEDGED: 'پوششی',
      CONSERVATIVE: 'محافظه‌کار',
      CUSTOM: 'سفارشی',
    };
    return {
      strategy: portfolio.strategy,
      strategyFa: strategyFa[portfolio.strategy] ?? portfolio.strategy,
      capitalRial: portfolio.capitalRial,
      noteFa: clipText(portfolio.preferencesNoteFa, 400),
      profile: profile
        ? {
            riskTolerance: profile.riskTolerance,
            horizonMonths: profile.horizonMonths,
            preferencesFa: clipText(profile.investmentPreferencesFa, 400),
            constraintsFa: clipText(profile.constraintsFa, 300),
            objectiveFa: clipText(profile.objectiveFa, 240),
            notesFa: clipText(profile.notes, 300),
            liquidityNeed: profile.liquidityNeed,
            maxDrawdownPct: profile.maxDrawdownPct,
            inflationSensitivity: profile.inflationSensitivity,
            fxSensitivity: profile.fxSensitivity,
          }
        : null,
    };
  }

  private async decisionMarket(userId: string): Promise<MarketState> {
    const platformUserId = (await this.users.getAdminUserId()) ?? userId;
    const [lessons, economicNews, worldMacroNews, fxHistory, spot] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { userId: platformUserId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { titleFa: true, bodyFa: true },
      }),
      this.news.getForPortfolioContext(userId, 20, 14),
      this.worldMarkets.recentMacroNews(),
      this.prisma.spotPriceDaily.findMany({
        orderBy: { dateKey: 'desc' },
        take: 8,
        select: { dateKey: true, usdIrr: true, goldGramRial: true },
      }),
      this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } }),
    ]);
    const news = splitNewsForPortfolio(economicNews);
    return {
      usdIrr: spot?.usdIrr && spot.usdIrr > 0 ? spot.usdIrr : null,
      goldGramRial: spot?.goldGramRial && spot.goldGramRial > 0 ? spot.goldGramRial : null,
      recent: [...fxHistory].reverse().map((row) => ({
        dateKey: row.dateKey,
        usdIrr: row.usdIrr,
        goldGramRial: row.goldGramRial,
      })),
      lessons: lessons.map((lesson) => ({
        title: lesson.titleFa,
        body: clipText(lesson.bodyFa, 400) ?? '',
      })),
      iranNews: news.economicNews.map((item) => ({
        date: item.date,
        title: item.title,
        summary: clipText(item.summary, 240) ?? '',
        impact: clipText(item.marketImpact, 160),
      })),
      opportunities: news.investmentOpportunities.map((item) => ({
        title: item.title,
        summary: clipText(item.summary, 200) ?? '',
        how: clipText(item.participateHow, 160),
      })),
      worldNews: worldMacroNews.map((item) => ({
        date: item.dateKey,
        title: item.titleFa,
        summary: clipText(item.summaryFa, 200) ?? '',
        iranImpact: clipText(item.iranImpactFa, 200),
      })),
    };
  }

  private async tradableOnLatest(assetType: AssetType): Promise<StockFact[]> {
    return (await this.tradableSnapshot(assetType)).rows;
  }

  /** نمادهای معامله‌شده و بدون صف در آخرین روز معاملاتی، همراه همان تاریخ. */
  private async tradableSnapshot(assetType: AssetType): Promise<{ tradeDate: Date | null; rows: StockFact[] }> {
    const visible = await visibleInstrumentsWhere(this.prisma);
    const latest = await this.prisma.priceBar.findFirst({
      where: {
        instrument: { isActive: true, assetType, ...visible },
        OR: [{ lastPrice: { gt: 0 } }, { closePrice: { gt: 0 } }],
      },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (!latest) return { tradeDate: null, rows: [] };
    const bars = await this.prisma.priceBar.findMany({
      where: {
        tradeDate: latest.tradeDate,
        instrument: { isActive: true, assetType, ...visible },
        OR: [{ lastPrice: { gt: 0 } }, { closePrice: { gt: 0 } }],
      },
      select: {
        lastPrice: true,
        closePrice: true,
        volume: true,
        eps: true,
        pe: true,
        raw: true,
        instrument: { select: { symbol: true, nameFa: true } },
      },
    });
    const rows: StockFact[] = [];
    for (const bar of bars) {
      const price = bar.lastPrice != null && bar.lastPrice > 0 ? bar.lastPrice : bar.closePrice;
      if (price == null || !(price > 0)) continue;
      if (bar.volume != null && !(bar.volume > 0)) continue;
      if (detectQueue(bar.raw, price)) continue;
      rows.push(
        buildStockFact({
          symbol: bar.instrument.symbol,
          nameFa: bar.instrument.nameFa,
          price,
          close: bar.closePrice,
          eps: bar.eps,
          pe: bar.pe,
          volume: bar.volume,
          raw: bar.raw,
        }),
      );
    }
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol, 'fa'));
    return { tradeDate: latest.tradeDate, rows };
  }

  private async busiestTradable(assetType: AssetType): Promise<StockFact | null> {
    const rows = await this.tradableOnLatest(assetType);
    rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return rows[0] ?? null;
  }

  private async attachMissingPrices<T extends { symbol: string }>(
    universe: Array<{ id: string; symbol: string; assetType: AssetType; lastPrice: number | null }>,
    items: T[],
  ) {
    const have = new Set(universe.map((row) => row.symbol));
    const missing = [...new Set(items.map((item) => item.symbol).filter((symbol) => symbol && !have.has(symbol)))];
    if (!missing.length) return universe;
    const rows = await this.prisma.instrument.findMany({
      where: { isActive: true, symbol: { in: missing } },
      include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 1 } },
    });
    return [
      ...rows.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        assetType: row.assetType,
        lastPrice: row.priceBars[0]?.lastPrice ?? row.priceBars[0]?.closePrice ?? null,
      })),
      ...universe,
    ];
  }
  async applyStrategy(
    userId: string,
    portfolioId: string,
    data: {
      labelFa?: string;
      strategySummaryFa: string;
      items: Array<{
        symbol: string;
        assetType: AssetType;
        weightPct: number;
        reasonFa: string;
      }>;
    },
  ) {
    const summary = data.labelFa
      ? `${data.labelFa}: ${data.strategySummaryFa}`
      : data.strategySummaryFa;
    return this.createSnapshotFromItems(userId, portfolioId, {
      strategySummaryFa: summary,
      items: data.items,
    });
  }

  private async createSnapshotFromItems(
    userId: string,
    portfolioId: string,
    out: {
      strategySummaryFa: string;
      items: Array<{
        symbol: string;
        assetType: AssetType;
        weightPct: number;
        reasonFa: string;
      }>;
    },
  ) {
    const portfolio = await this.get(userId, portfolioId);
    const universe = await this.attachMissingPrices(await this.buildUniverse(), out.items ?? []);
    const items = this.materializeItems(out.items ?? [], portfolio.capitalRial, universe);
    const totalValueRial = items.reduce((s, i) => s + i.amountRial, 0);
    return this.prisma.portfolioSnapshot.create({
      data: {
        portfolioId,
        kind: SnapshotKind.SUGGESTION,
        strategySummaryFa: out.strategySummaryFa ?? 'پیشنهاد سبد',
        totalValueRial: Math.min(totalValueRial, portfolio.capitalRial),
        items: { create: items },
      },
      include: { items: true },
    });
  }

  async getChat(userId: string, portfolioId: string) {
    await this.get(userId, portfolioId);
    return this.prisma.portfolioChatMessage.findMany({
      where: { portfolioId, userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async hideChat(userId: string, portfolioId: string) {
    await this.get(userId, portfolioId);
    await this.prisma.portfolioChatMessage.updateMany({
      where: { portfolioId, userId, status: 'active' },
      data: { status: 'hidden' },
    });
    return { ok: true };
  }

  async hideEvents(userId: string, portfolioId: string) {
    await this.get(userId, portfolioId);
    await this.prisma.portfolioEvent.updateMany({
      where: { portfolioId, status: 'active' },
      data: { status: 'hidden' },
    });
    return { ok: true };
  }

  async postChat(userId: string, portfolioId: string, message: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });

    await this.prisma.portfolioChatMessage.create({
      data: { portfolioId, userId, role: 'user', contentFa: message },
    });

    const history = await this.prisma.portfolioChatMessage.findMany({
      where: { portfolioId, userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });

    const historyText = history
      .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.contentFa}`)
      .join('\n');

    const recentUserText = history
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.contentFa)
      .join('\n');

    const holdingSymbols = (latest?.items ?? []).map((i) => i.symbol);
    const marketStatus = await this.buildPortfolioChatMarketStatus(recentUserText, holdingSymbols);

    const holdings = (latest?.items ?? []).map((i) => ({
      symbol: i.symbol,
      assetType: i.assetType,
      quantity: i.quantity,
      amountRial: i.amountRial,
      lastPrice: (i as { lastPrice?: number | null }).lastPrice ?? i.unitPrice ?? null,
      avgBuyPrice: i.avgBuyPrice ?? i.unitPrice ?? null,
      pnlRial: (i as { pnlRial?: number | null }).pnlRial ?? null,
      inPortfolio: true,
    }));

    let reply: string;
    try {
      const chatSystem = await this.llm.getSystemPrompt(userId, 'portfolio_chat');
      reply = await this.llm.chatText(
        'portfolio_chat',
        chatSystem,
        `دادهٔ سبد و بازار از پایگاه سبدیار (تنها منبع عدد):\n${JSON.stringify(
          {
            portfolio: {
              name: portfolio.name,
              strategy: portfolio.strategy,
              capitalRial: portfolio.capitalRial,
              cashRial: portfolio.cashRial,
              latestSummaryFa: latest?.strategySummaryFa ?? null,
              preferencesFa: profile?.investmentPreferencesFa ?? '',
              constraintsFa: profile?.constraintsFa ?? '',
              portfolioNoteFa: portfolio.preferencesNoteFa ?? '',
            },
            holdings,
            marketStatus,
            noteFa:
              'اگر نماد در holdings نیست، در سبد فعلی نیست. وضعیت سهام/دلار/طلا را از marketStatus بگو.',
          },
          null,
          2,
        )}

قوانین این نوبت (بر محدودیت «فقط نمادهای داخل سبد» اولویت دارد):
- به سؤال دربارهٔ سهام، صندوق بورسی، شاخص، دلار آزاد و طلا پاسخ بده حتی اگر در سبد نباشد.
- اگر در سبد نبود، همین را بگو و فقط وضعیت بازار را از داده گزارش کن.
- قیمت را از دانش عمومی نساز؛ اگر در JSON نبود بگو در دیتابیس نیست.
- سؤال غیرمالی را کوتاه رد کن.

گفتگو:
${historyText}`,
        userId,
      );
    } catch (e) {
      if (e instanceof AiQuotaExceededException) throw e;
      reply = `متأسفانه LLM در دسترس نیست. (${(e as Error).message.slice(0, 120)})`;
    }

    let cleanReply = reply;
    const jsonMatch = reply.match(/\{[\s\S]*"preferencesFa"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const extracted = JSON.parse(jsonMatch[0]) as {
          preferencesFa?: string;
          constraintsFa?: string;
          portfolioNoteFa?: string;
        };
        cleanReply = reply.replace(jsonMatch[0], '').trim();
        if (extracted.preferencesFa || extracted.constraintsFa) {
          await this.prisma.userProfile.upsert({
            where: { userId },
            create: {
              userId,
              investmentPreferencesFa: extracted.preferencesFa,
              constraintsFa: extracted.constraintsFa,
            },
            update: {
              ...(extracted.preferencesFa
                ? { investmentPreferencesFa: extracted.preferencesFa }
                : {}),
              ...(extracted.constraintsFa ? { constraintsFa: extracted.constraintsFa } : {}),
            },
          });
        }
        if (extracted.portfolioNoteFa) {
          await this.prisma.portfolio.update({
            where: { id: portfolioId },
            data: { preferencesNoteFa: extracted.portfolioNoteFa },
          });
        }
      } catch {
        /* ignore parse */
      }
    }

    const assistantMsg = await this.prisma.portfolioChatMessage.create({
      data: { portfolioId, userId, role: 'assistant', contentFa: cleanReply },
    });

    return assistantMsg;
  }

  /** قیمت دلار/طلا و نمادهای ذکرشده در گفتگو — حتی اگر در سبد نباشند */
  private async buildPortfolioChatMarketStatus(question: string, holdingSymbols: string[]) {
    const foldedQ = foldFa(question);
    const tokens = tokenizeMarketQuestion(question);
    const holdingFolded = new Set(holdingSymbols.map((s) => foldFa(s)));

    const wantGold = /طلا|سکه|انس|مثقال|عیار|PHYSICAL_GOLD/.test(foldedQ);
    const wantUsd = /دلار|ارز|PHYSICAL_USD|\busd\b/.test(foldedQ);
    const wantIndex = /شاخص|بورس/.test(foldedQ);

    const [spot, macro, fxHistory] = await Promise.all([
      this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } }),
      this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } }),
      this.prisma.spotPriceDaily.findMany({
        where: { dateKey: { gte: daysAgoDateKey(14) } },
        orderBy: { dateKey: 'asc' },
        select: { dateKey: true, usdIrr: true, goldGramRial: true },
        take: 16,
      }),
    ]);

    const usdIrr =
      (spot?.usdIrr && spot.usdIrr > 0 ? spot.usdIrr : null) ??
      (macro?.usdIrr && macro.usdIrr > 0 ? macro.usdIrr : null);
    const goldGramRial =
      spot?.goldGramRial && spot.goldGramRial > 0
        ? spot.goldGramRial
        : usdIrr != null
          ? usdIrr * 75
          : null;

    const tokenOr: Prisma.InstrumentWhereInput[] = tokens.flatMap((t) => {
      const clauses: Prisma.InstrumentWhereInput[] = [{ symbol: t }];
      if (t !== t.toUpperCase()) clauses.push({ symbol: t.toUpperCase() });
      if (t.length >= 3) clauses.push({ nameFa: { contains: t } });
      return clauses;
    });

    const rows = tokenOr.length
      ? await this.prisma.instrument.findMany({
          where: {
            isActive: true,
            assetType: {
              in: [AssetType.STOCK, AssetType.FUND, AssetType.GOLD_ETF, AssetType.INDEX],
            },
            OR: tokenOr,
          },
          take: 24,
          include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 6 } },
        })
      : [];

    const goldEtfs =
      wantGold
        ? await this.prisma.instrument.findMany({
            where: { isActive: true, assetType: AssetType.GOLD_ETF },
            take: 4,
            include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 6 } },
          })
        : [];

    const indexRows = wantIndex
      ? await this.prisma.instrument.findMany({
          where: { isActive: true, symbol: { in: ['TEDPIX', 'TESWEQ'] } },
          include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 6 } },
        })
      : [];

    const merged = [...rows, ...goldEtfs, ...indexRows];
    const seen = new Set<string>();
    const scored = merged
      .map((r) => {
        const sym = foldFa(r.symbol);
        const name = foldFa(r.nameFa);
        let score = 0;
        if (tokens.includes(sym) || (sym.length >= 3 && foldedQ.includes(sym))) score += 8;
        if (tokens.some((t) => t.length >= 3 && name.includes(t))) score += 3;
        if (wantGold && r.assetType === AssetType.GOLD_ETF) score += 4;
        if (wantIndex && (r.symbol === 'TEDPIX' || r.symbol === 'TESWEQ')) score += 6;
        if (r.assetType === AssetType.STOCK) score += 1;
        return { ...r, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const instruments: Array<{
      symbol: string;
      nameFa: string;
      assetType: AssetType;
      inPortfolio: boolean;
      last: {
        tradeDate: Date;
        lastPrice: number | null;
        closePrice: number | null;
        eps: number | null;
        pe: number | null;
        volume: number | null;
      } | null;
      recentBars: Array<{ tradeDate: Date; lastPrice: number | null; closePrice: number | null }>;
    }> = [];

    for (const r of scored) {
      const key = foldFa(r.symbol);
      if (seen.has(r.id) || seen.has(key)) continue;
      seen.add(r.id);
      seen.add(key);
      const last = r.priceBars[0] ?? null;
      instruments.push({
        symbol: r.symbol,
        nameFa: r.nameFa,
        assetType: r.assetType,
        inPortfolio: holdingFolded.has(key),
        last: last
          ? {
              tradeDate: last.tradeDate,
              lastPrice: last.lastPrice,
              closePrice: last.closePrice,
              eps: last.eps,
              pe: last.pe,
              volume: last.volume,
            }
          : null,
        recentBars: [...r.priceBars]
          .reverse()
          .map((b) => ({
            tradeDate: b.tradeDate,
            lastPrice: b.lastPrice,
            closePrice: b.closePrice,
          })),
      });
      if (instruments.length >= 8) break;
    }

    return {
      askedGold: wantGold,
      askedUsd: wantUsd,
      usd: usdIrr != null ? { usdIrr, dateKey: spot?.dateKey ?? null } : null,
      gold: goldGramRial != null ? { goldGramRial, dateKey: spot?.dateKey ?? null } : null,
      fxRecent: fxHistory,
      mentionedInstruments: instruments,
      lookupNoteFa:
        tokens.length && instruments.length === 0
          ? 'نماد ذکرشده در دیتابیس قیمت یافت نشد.'
          : null,
    };
  }

  async rebalance(
    userId: string,
    portfolioId: string,
    noteFa?: string,
    opts?: { skipBilling?: boolean },
  ) {
    const charged = opts?.skipBilling ? 0 : await this.wallet.charge(userId, 'rebalance');
    try {
      return await this.rebalanceCharged(userId, portfolioId, noteFa);
    } catch (e) {
      await this.wallet.refund(userId, charged, 'rebalance');
      throw e;
    }
  }

  private async rebalanceCharged(userId: string, portfolioId: string, noteFa?: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    const snapshot = await this.suggest(userId, portfolioId, { skipBilling: true });
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

    const system = await this.llm.getSystemPrompt(userId, 'monthly_eval');
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
    } catch (e) {
      if (e instanceof AiQuotaExceededException) throw e;
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

    const rebalanced = await this.rebalance(userId, portfolioId, evalOut.summaryFa, { skipBilling: true });
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
    items: Array<{
      symbol: string;
      weightPct: number;
      quantity?: number;
      assetType?: AssetType;
      reasonFa?: string;
    }>,
    options?: { skipEvent?: boolean; noteFa?: string },
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

      const prevQty = prev?.quantity ?? 0;
      const prevAvg =
        (prev as { avgBuyPrice?: number | null } | undefined)?.avgBuyPrice ??
        prev?.unitPrice ??
        price;
      let avgBuyPrice = price;
      if (prev && prevQty > 0) {
        if (quantity > prevQty + 1e-9) {
          const added = quantity - prevQty;
          avgBuyPrice = (prevQty * prevAvg + added * price) / quantity;
        } else {
          avgBuyPrice = prevAvg;
        }
      }

      return {
        symbol: i.symbol.trim(),
        assetType: i.assetType ?? prev?.assetType ?? u?.assetType ?? AssetType.STOCK,
        weightPct,
        quantity,
        amountRial,
        unitPrice: price,
        avgBuyPrice,
        reasonFa: i.reasonFa ?? prev?.reasonFa ?? 'ویرایش دستی کاربر',
        instrumentId: u?.id && !u.id.startsWith('synthetic-') ? u.id : undefined,
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

    if (!options?.skipEvent) {
      await this.prisma.portfolioEvent.create({
        data: {
          portfolioId,
          type: PortfolioEventType.WEIGHT_EDIT,
          payload: { items },
          noteFa: options?.noteFa ?? 'ویرایش وزن/مقدار توسط کاربر',
        },
      });
    }

    return snapshot;
  }

  async addItem(
    userId: string,
    portfolioId: string,
    data: {
      symbol: string;
      assetType: AssetType;
      quantity?: number;
      amountRial?: number;
      reasonFa?: string;
    },
  ) {
    const { latest } = await this.requireOwnedLatestSnapshot(
      userId,
      portfolioId,
      'ابتدا یک پیشنهاد یا اسنپ‌شات بسازید',
    );

    const symbol = data.symbol.trim();
    if (!symbol) throw new NotFoundException('نماد نامعتبر است');
    if (latest.items.some((i) => i.symbol === symbol)) {
      throw new BadRequestException('این نماد از قبل در سبد هست');
    }

    const priced = await this.latestPriceForSymbol(symbol, data.assetType);
    const { quantity, amountRial } = this.resolveQtyAndAmount(
      priced.price,
      data.quantity,
      data.amountRial,
    );

    const rows = [
      ...latest.items.map((i) => this.holdingFromItem(i)),
      {
        symbol,
        assetType: data.assetType,
        quantity,
        amountRial,
        unitPrice: priced.price,
        avgBuyPrice: priced.price,
        reasonFa: data.reasonFa ?? 'افزودن دستی توسط کاربر',
        instrumentId: priced.instrumentId,
      },
    ];

    return this.writeHoldingsSnapshot(portfolioId, latest, rows, {
      type: PortfolioEventType.BUY,
      payload: {
        symbol,
        quantity,
        amountRial,
        unitPrice: priced.price,
        assetType: data.assetType,
      },
      noteFa: `افزودن نماد ${symbol}`,
    });
  }

  async editItem(
    userId: string,
    portfolioId: string,
    symbol: string,
    data: { quantity?: number; amountRial?: number },
  ) {
    const { latest } = await this.requireOwnedLatestSnapshot(userId, portfolioId);
    const key = symbol.trim();
    const current = latest.items.find((i) => i.symbol === key);
    if (!current) throw new NotFoundException('نماد در سبد یافت نشد');

    const priced = await this.latestPriceForSymbol(current.symbol, current.assetType);
    const { quantity, amountRial } = this.resolveQtyAndAmount(
      priced.price,
      data.quantity,
      data.amountRial,
    );

    const prevQty = current.quantity ?? 0;
    const prevAvg = current.avgBuyPrice ?? current.unitPrice ?? priced.price;
    const avgBuyPrice = this.nextAvgBuyPrice(prevQty, prevAvg, quantity, priced.price);

    const rows = latest.items.map((i) => {
      if (i.symbol !== key) return this.holdingFromItem(i);
      return {
        symbol: current.symbol,
        assetType: current.assetType,
        quantity,
        amountRial,
        unitPrice: priced.price,
        avgBuyPrice,
        reasonFa: current.reasonFa,
        instrumentId: priced.instrumentId ?? current.instrumentId ?? undefined,
      };
    });

    return this.writeHoldingsSnapshot(portfolioId, latest, rows, {
      type: PortfolioEventType.WEIGHT_EDIT,
      payload: {
        symbol: key,
        quantity,
        amountRial,
        unitPrice: priced.price,
      },
      noteFa: `ویرایش تعداد/مبلغ ${key}`,
    });
  }

  async removeItem(userId: string, portfolioId: string, symbol: string) {
    const { latest } = await this.requireOwnedLatestSnapshot(userId, portfolioId);
    const remaining = latest.items.filter((i) => i.symbol !== symbol);
    if (remaining.length === latest.items.length) {
      throw new NotFoundException('نماد در سبد یافت نشد');
    }
    if (remaining.length === 0) {
      throw new BadRequestException('حداقل یک نماد باید در سبد بماند');
    }

    const rows = remaining.map((i) => this.holdingFromItem(i));
    return this.writeHoldingsSnapshot(portfolioId, latest, rows, {
      type: PortfolioEventType.SELL,
      payload: { symbol },
      noteFa: `حذف نماد ${symbol}`,
    });
  }

  private holdingFromItem(item: {
    symbol: string;
    assetType: AssetType;
    quantity: number;
    amountRial: number;
    unitPrice?: number | null;
    avgBuyPrice?: number | null;
    reasonFa: string;
    instrumentId?: string | null;
  }) {
    const unitPrice = item.unitPrice ?? 0;
    return {
      symbol: item.symbol,
      assetType: item.assetType,
      quantity: item.quantity,
      amountRial: item.amountRial,
      unitPrice,
      avgBuyPrice: item.avgBuyPrice ?? unitPrice,
      reasonFa: item.reasonFa,
      instrumentId: item.instrumentId ?? undefined,
    };
  }

  private nextAvgBuyPrice(
    prevQty: number,
    prevAvg: number,
    newQty: number,
    lastPrice: number,
  ) {
    if (prevQty > 0 && newQty > prevQty + 1e-9) {
      const added = newQty - prevQty;
      return (prevQty * prevAvg + added * lastPrice) / newQty;
    }
    if (prevQty > 0) return prevAvg;
    return lastPrice;
  }

  private resolveQtyAndAmount(
    price: number,
    quantity?: number,
    amountRial?: number,
  ): { quantity: number; amountRial: number } {
    if (!(price > 0) || !Number.isFinite(price)) {
      throw new BadRequestException('آخرین قیمت این نماد نامعتبر است');
    }
    const qtyOk = quantity != null && Number.isFinite(quantity) && quantity > 0;
    const amtOk = amountRial != null && Number.isFinite(amountRial) && amountRial > 0;
    if (qtyOk && !amtOk) {
      return { quantity: quantity!, amountRial: quantity! * price };
    }
    if (amtOk && !qtyOk) {
      return { quantity: amountRial! / price, amountRial: amountRial! };
    }
    if (qtyOk && amtOk) {
      return { quantity: quantity!, amountRial: quantity! * price };
    }
    throw new BadRequestException('تعداد سهم یا مبلغ کل خرید را وارد کنید');
  }

  private async latestPriceForSymbol(
    symbol: string,
    assetType?: AssetType,
  ): Promise<{ price: number; instrumentId?: string }> {
    const key = symbol.trim();
    const upper = key.toUpperCase();

    if (assetType === AssetType.CASH || assetType === AssetType.DEPOSIT) {
      return { price: 1 };
    }

    const universe = await this.buildUniverse();
    const fromUniverse = universe.find(
      (u) => u.symbol.trim() === key || u.symbol.trim().toUpperCase() === upper,
    );
    if (fromUniverse?.lastPrice != null && fromUniverse.lastPrice > 0) {
      return {
        price: fromUniverse.lastPrice,
        instrumentId: fromUniverse.id.startsWith('synthetic-') ? undefined : fromUniverse.id,
      };
    }

    const inst = await this.prisma.instrument.findFirst({
      where: {
        isActive: true,
        symbol: { equals: key, mode: 'insensitive' },
        ...(await visibleInstrumentsWhere(this.prisma)),
      },
      include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 1 } },
    });
    if (
      !inst &&
      (assetType === AssetType.OPTION || !assetType)
    ) {
      const expired = await this.prisma.instrument.findFirst({
        where: {
          isActive: true,
          assetType: AssetType.OPTION,
          symbol: { equals: key, mode: 'insensitive' },
        },
        select: { meta: true, assetType: true, nameFa: true, symbol: true },
      });
      if (expired && optionMetaExpired(expired.meta, expired.assetType, { nameFa: expired.nameFa, symbol: expired.symbol })) {
        throw new BadRequestException('سررسید این اختیار معامله گذشته است و در سبد نمی‌آید.');
      }
    }
    const bar = inst?.priceBars[0];
    const price = bar?.lastPrice ?? bar?.closePrice ?? null;
    if (inst && price != null && price > 0) {
      return { price, instrumentId: inst.id };
    }

    throw new BadRequestException(
      `آخرین قیمت «${key}» در دیتابیس یافت نشد. ابتدا باید قیمت نماد در سیستم باشد.`,
    );
  }

  private async requireOwnedLatestSnapshot(
    userId: string,
    portfolioId: string,
    emptyMessage = 'نسخه‌ای برای ویرایش نیست',
  ) {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { id: portfolioId },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          include: { items: true },
        },
      },
    });
    if (!portfolio) throw new NotFoundException('سبد یافت نشد');
    if (portfolio.userId !== userId) throw new ForbiddenException();
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException(emptyMessage);
    return { portfolio, latest };
  }

  private async writeHoldingsSnapshot(
    portfolioId: string,
    latest: { id: string; strategySummaryFa: string | null },
    rows: Array<{
      symbol: string;
      assetType: AssetType;
      quantity: number;
      amountRial: number;
      unitPrice: number;
      avgBuyPrice: number;
      reasonFa: string;
      instrumentId?: string;
    }>,
    event: { type: PortfolioEventType; payload: object; noteFa: string },
  ) {
    const total = rows.reduce((s, r) => s + r.amountRial, 0);
    const mapped = rows.map((r) => ({
      symbol: r.symbol.trim(),
      assetType: r.assetType,
      weightPct: total > 0 ? (r.amountRial / total) * 100 : 0,
      quantity: r.quantity,
      amountRial: r.amountRial,
      unitPrice: r.unitPrice,
      avgBuyPrice: r.avgBuyPrice,
      reasonFa: r.reasonFa,
      ...(r.instrumentId ? { instrumentId: r.instrumentId } : {}),
    }));

    const snapshot = await this.prisma.portfolioSnapshot.create({
      data: {
        portfolioId,
        kind: SnapshotKind.USER_ADJUSTED,
        strategySummaryFa: latest.strategySummaryFa,
        totalValueRial: total,
        items: { create: mapped },
        meta: { basedOn: latest.id },
      },
      include: { items: true },
    });

    await this.prisma.portfolioEvent.create({
      data: {
        portfolioId,
        type: event.type,
        payload: event.payload,
        noteFa: event.noteFa,
      },
    });

    return snapshot;
  }

  /**
   * خلاصهٔ سبد برای پیام روزانه تلگرام: ترکیب فعلی + آنالیز با بازار/ارز/اخبار
   */
  async telegramPortfolioBriefing(userId: string) {
    const portfolios = await this.prisma.portfolio.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true },
    });
    if (!portfolios.length) {
      return { hasPortfolio: false as const };
    }

    const main = portfolios[0];
    const enriched = await this.get(userId, main.id);
    const latest = enriched.snapshots[0];
    const rawItems = latest?.items ?? [];
    const totalValue = rawItems.reduce(
      (s, i) => s + (Number((i as { marketValueRial?: number }).marketValueRial ?? i.amountRial) || 0),
      0,
    );
    const items = rawItems
      .map((i) => {
        const amountRial =
          Number((i as { marketValueRial?: number }).marketValueRial ?? i.amountRial) || 0;
        const weightPct =
          totalValue > 0 ? (amountRial / totalValue) * 100 : Number(i.weightPct) || 0;
        return {
          symbol: i.symbol,
          weightPct,
          amountRial,
          pnlRial: Number((i as { pnlRial?: number }).pnlRial) || 0,
          assetType: i.assetType,
        };
      })
      .sort((a, b) => b.weightPct - a.weightPct);

    const fx = await this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } });

    let analysis: Awaited<ReturnType<PortfoliosService['analyzeCurrent']>> | null = null;
    const ai = await this.users.aiAccess(userId);
    if (latest && ai.portfolio) {
      try {
        analysis = await this.analyzeCurrent(userId, main.id, {
          pastTenseFa: true,
          personalHoldingsOnly: true,
        });
      } catch (e) {
        analysis = {
          score: 50,
          summaryFa: `آنالیز سبد در دسترس نبود. (${(e as Error).message.slice(0, 120)})`,
          strengthsFa: [],
          weaknessesFa: [],
          suggestions: [],
          analyzedAt: new Date().toISOString(),
        };
      }
    }

    return {
      hasPortfolio: true as const,
      name: enriched.name,
      strategy: enriched.strategy,
      capitalRial: enriched.capitalRial,
      cashRial: enriched.cashRial,
      totalValueRial: totalValue || enriched.capitalRial,
      otherNames: portfolios.slice(1).map((p) => p.name),
      items,
      fx: fx
        ? { dateKey: fx.dateKey, usdIrr: fx.usdIrr, goldGramRial: fx.goldGramRial }
        : null,
      analysis,
    };
  }

  async analyzeCurrent(
    userId: string,
    portfolioId: string,
    opts?: { pastTenseFa?: boolean; personalHoldingsOnly?: boolean; bill?: boolean },
  ) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('سبدی برای آنالیز وجود ندارد');

    const personal = opts?.personalHoldingsOnly === true;
    const universe = await this.buildUniverse();
    const macro = personal
      ? null
      : await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const economicNews = personal ? [] : await this.news.getForPortfolioContext(userId, 40, 30);
    const worldMacroNews = personal ? [] : await this.worldMarkets.recentMacroNews();
    const fxHistory = personal
      ? []
      : await this.prisma.spotPriceDaily.findMany({
          where: { dateKey: { gte: daysAgoDateKey(30) } },
          orderBy: { dateKey: 'asc' },
          select: { dateKey: true, usdIrr: true, goldGramRial: true },
          take: 35,
        });
    const platformUserId = (await this.users.getAdminUserId()) ?? userId;
    const lessons = personal
      ? []
      : await this.prisma.lesson.findMany({
          where: { userId: platformUserId },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });

    const pricedItems = latest.items.map((i) => {
      const u = universe.find((x) => x.symbol === i.symbol);
      return {
        symbol: i.symbol,
        assetType: i.assetType,
        weightPct: i.weightPct,
        amountRial: i.amountRial,
        quantity: i.quantity,
        unitPrice: u?.lastPrice ?? i.unitPrice,
        lastMarketPrice: u?.lastPrice ?? null,
        pe: u?.pe ?? null,
        reasonFa: i.reasonFa,
      };
    });

    const fees = await this.tradeFees.read();
    const optionBoard = await this.market.getOptionBoard().catch(() => null);
    let system = await this.llm.getSystemPrompt(userId, 'portfolio_analyze');
    system += `\n\n${feeInstructionFa(fees)}`;
    if (personal) {
      system += `

این فراخوانی فقط برای سبد همین کاربر در پیام تلگرام است.
اخبار روز و متن مشترک پیام جدا ساخته شده‌اند و برای همه یکسان فرستاده می‌شوند؛ آن‌ها را خلاصه، تکرار یا از نو ننویس.
فقط ترکیب فعلی سبد (نماد، وزن، مبلغ، قیمت) را ارزیابی کن و پیشنهاد بهبود همان سبد را بده.
summaryFa فقط دربارهٔ همین سبد باشد.`;
    }
    if (opts?.pastTenseFa) {
      system += `

این خروجی برای پیام تلگرام است.
summaryFa و نقاط قوت و ضعف گزارش وضعیت سبد هستند و باید با فعل گذشته باشند.
عنوان و متن هر پیشنهاد بهبود (titleFa و bodyFa) باید با فعل آینده باشند، نه گذشته و نه حال.
مثال درست: «وزن این نماد کاهش پیدا خواهد کرد.» مثال غلط: «وزن این نماد کم شد» یا «پیشنهاد این بود که…».
فیلدهای action/symbol/amountRial را عوض نکن.`;
    }
    const portfolioPayload = {
      name: portfolio.name,
      strategy: portfolio.strategy,
      capitalRial: portfolio.capitalRial,
      cashRial: portfolio.cashRial,
      preferencesNoteFa: portfolio.preferencesNoteFa,
    };
    const news = splitNewsForPortfolio(economicNews);
    const fullPrompt = JSON.stringify(
      personal
        ? {
            portfolio: portfolioPayload,
            userProfile: compactProfile(profile),
            currentItems: pricedItems.map((item) => ({
              ...item,
              reasonFa: clipText(item.reasonFa, 160),
            })),
            tradeFees: fees,
            optionBoard: optionBoard ? optionBoardForPrompt(optionBoard) : null,
            optionRuleFa:
              'اگر نمادی صف خرید یا صف فروش است، خرید خود سهم را پیشنهاد نکن. جایگزین را از replacements یا worthwhileOptions بردار.',
          }
        : {
            portfolio: portfolioPayload,
            userProfile: compactProfile(profile),
            currentItems: pricedItems.map((item) => ({
              ...item,
              reasonFa: clipText(item.reasonFa, 160),
            })),
            macro: macro
              ? {
                  asOfDate: macro.asOfDate,
                  inflationPct: macro.inflationPct,
                  interestRatePct: macro.interestRatePct,
                  usdIrr: macro.usdIrr,
                  geoRiskScore: macro.geoRiskScore,
                  summaryFa: clipText(macro.summaryFa, 400),
                }
              : null,
            economicNews: news.economicNews.map((item) => ({
              ...item,
              summary: clipText(item.summary, 220),
              marketImpact: clipText(item.marketImpact, 180),
            })),
            investmentOpportunities: news.investmentOpportunities.map((item) => ({
              ...item,
              summary: clipText(item.summary, 220),
              participateHow: clipText(item.participateHow, 180),
            })),
            worldMacroNews: worldMacroNews.map((item) => ({
              dateKey: item.dateKey,
              titleFa: item.titleFa,
              summaryFa: clipText(item.summaryFa, 220),
              iranImpactFa: clipText(item.iranImpactFa, 220),
              assetsFa: item.assetsFa,
              impactDirection: item.impactDirection,
            })),
            fxHistory: fxHistory.slice(-10),
            lessons: lessons.slice(0, 8).map((lesson) => ({
              title: lesson.titleFa,
              body: clipText(lesson.bodyFa, 220),
            })),
            tradeFees: fees,
            optionBoard: optionBoard ? optionBoardForPrompt(optionBoard) : null,
            optionRuleFa:
              'اگر نمادی صف خرید یا صف فروش است، خرید خود سهم را پیشنهاد نکن. جایگزین را از replacements یا worthwhileOptions بردار.',
          },
    );
    const slimPrompt = JSON.stringify({
      portfolio: portfolioPayload,
      currentItems: pricedItems.map((item) => ({
        symbol: item.symbol,
        assetType: item.assetType,
        weightPct: item.weightPct,
        amountRial: item.amountRial,
        unitPrice: item.unitPrice,
      })),
      tradeFees: fees,
      optionBoard: optionBoard ? optionBoardForPrompt(optionBoard) : null,
      noteFa: 'تلاش کوتاه بعد از قطع پاسخ مدل. فقط ترکیب و قیمت همین سبد را ارزیابی کن و نماد داخل صف خرید یا فروش را برای خرید پیشنهاد نکن.',
    });

    type AnalysisOut = {
      score: number;
      summaryFa: string;
      strengthsFa: string[];
      weaknessesFa: string[];
      suggestions: Array<{
        titleFa: string;
        bodyFa: string;
        priority?: string;
        action?: string;
        symbol?: string;
        assetType?: string;
        quantity?: number;
        amountRial?: number;
        weightPct?: number;
        expectedProfitPct?: number | null;
      }>;
    };

    let analysis: AnalysisOut;
    const charged = opts?.bill ? await this.wallet.charge(userId, 'suggest') : 0;
    try {
      try {
        analysis = await this.llm.chatJson<AnalysisOut>(
          'portfolio_analyze',
          system,
          fullPrompt,
          userId,
        );
      } catch (first) {
        if (!isLlmGatewayFailure(first)) throw first;
        analysis = await this.llm.chatJson<AnalysisOut>(
          'portfolio_analyze',
          system,
          slimPrompt,
          userId,
        );
      }
    } catch (e) {
      if (e instanceof AiQuotaExceededException) {
        await this.wallet.refund(userId, charged, 'suggest');
        throw e;
      }
      await this.wallet.refund(userId, charged, 'suggest');
      analysis = {
        score: 55,
        summaryFa:
          'آنالیز خودکار بدون مدل زبانی: ترکیب فعلی را با اخبار و قیمت روز بررسی کنید. جزئیات فنی در بخش خطاهای مشاهده‌شدهٔ تنظیمات ادمین است.',
        strengthsFa: ['وجود تخصیص ثبت‌شده در سبد'],
        weaknessesFa: ['دسترسی به مدل زبانی برای تحلیل عمیق‌تر برقرار نشد'],
        suggestions: [
          {
            titleFa: 'بررسی مجدد وزن‌ها',
            bodyFa: 'وزن سهام، طلا و نقد را با شرایط تورمی و اخبار روز تطبیق دهید.',
            priority: 'medium',
            action: 'SKIP',
          },
        ],
      };
    }

    const score = Math.min(100, Math.max(0, Math.round(Number(analysis.score) || 0)));
    return {
      score,
      summaryFa: analysis.summaryFa ?? '',
      strengthsFa: analysis.strengthsFa ?? [],
      weaknessesFa: analysis.weaknessesFa ?? [],
      suggestions: (analysis.suggestions ?? [])
        .map((s) => this.normalizeAnalysisSuggestion(s))
        .map((s) => (optionBoard ? redirectAnalysisSuggestion(s, optionBoard) : s))
        .filter((s) => suggestionClearsFees(s, fees)),
      analyzedAt: new Date().toISOString(),
    };
  }

  async applySuggestion(
    userId: string,
    portfolioId: string,
    data: {
      titleFa: string;
      bodyFa: string;
      priority?: string;
      action?: 'ADD' | 'INCREASE' | 'DECREASE' | 'REMOVE' | 'SET' | 'SKIP';
      symbol?: string;
      assetType?: AssetType;
      quantity?: number;
      amountRial?: number;
      weightPct?: number;
    },
  ) {
    const action = data.action;
    const symbol = data.symbol?.trim() ?? '';
    if (!action || action === 'SKIP' || !symbol || !this.isConcreteSuggestionAction(data)) {
      throw new BadRequestException(
        'این پیشنهاد مقدار یا نماد مشخصی برای نوشتن در سبد ندارد.',
      );
    }

    return this.executeSuggestionAction(userId, portfolioId, {
      action,
      symbol,
      assetType: data.assetType,
      quantity: data.quantity,
      amountRial: data.amountRial,
      weightPct: data.weightPct,
      reasonFa: data.titleFa,
    });
  }

  /** پیشنهادهای آنالیز را بدون مدل، به ترتیب، روی آخرین ترکیب سبد می‌نویسد. */
  async applySuggestions(
    userId: string,
    portfolioId: string,
    suggestions: Array<{
      titleFa: string;
      bodyFa: string;
      priority?: string;
      action?: 'ADD' | 'INCREASE' | 'DECREASE' | 'REMOVE' | 'SET' | 'SKIP';
      symbol?: string;
      assetType?: AssetType;
      quantity?: number;
      amountRial?: number;
      weightPct?: number;
    }>,
  ) {
    const concrete = suggestions.filter((item) => this.isConcreteSuggestionAction(item));
    if (!concrete.length) {
      throw new BadRequestException('در این فهرست پیشنهادی با مقدار مشخص برای اعمال روی سبد نیست.');
    }
    const charged = await this.wallet.charge(userId, 'rebalance');
    try {
      for (const item of concrete) {
        await this.applySuggestion(userId, portfolioId, item);
      }
      return this.get(userId, portfolioId);
    } catch (e) {
      await this.wallet.refund(userId, charged, 'rebalance');
      throw e;
    }
  }

  private normalizeAnalysisSuggestion(s: {
    titleFa?: string;
    bodyFa?: string;
    priority?: string;
    action?: string;
    symbol?: string;
    assetType?: string;
    quantity?: number;
    amountRial?: number;
    weightPct?: number;
    expectedProfitPct?: number | null;
  }) {
    const actionRaw = String(s.action ?? '').toUpperCase();
    const action = (
      ['ADD', 'INCREASE', 'DECREASE', 'REMOVE', 'SET', 'SKIP'] as const
    ).includes(actionRaw as 'ADD')
      ? (actionRaw as 'ADD' | 'INCREASE' | 'DECREASE' | 'REMOVE' | 'SET' | 'SKIP')
      : undefined;
    const assetType = Object.values(AssetType).includes(s.assetType as AssetType)
      ? (s.assetType as AssetType)
      : undefined;
    const num = (v: number | undefined) =>
      v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
    const expectedRaw = Number(s.expectedProfitPct);
    const expectedProfitPct = Number.isFinite(expectedRaw) ? expectedRaw : undefined;
    return {
      titleFa: s.titleFa ?? '',
      bodyFa: s.bodyFa ?? '',
      priority: s.priority,
      action,
      symbol: s.symbol?.trim() || undefined,
      assetType,
      quantity: num(s.quantity),
      amountRial: num(s.amountRial),
      weightPct: num(s.weightPct),
      expectedProfitPct,
    };
  }

  private isConcreteSuggestionAction(data: {
    action?: string;
    symbol?: string;
    quantity?: number;
    amountRial?: number;
    weightPct?: number;
  }) {
    const action = data.action;
    if (!action || action === 'SKIP' || !data.symbol?.trim()) return false;
    if (action === 'REMOVE') return true;
    return (
      (data.quantity != null && data.quantity > 0) ||
      (data.amountRial != null && data.amountRial > 0) ||
      (data.weightPct != null && data.weightPct > 0)
    );
  }

  private async executeSuggestionAction(
    userId: string,
    portfolioId: string,
    act: {
      action: 'ADD' | 'INCREASE' | 'DECREASE' | 'REMOVE' | 'SET';
      symbol: string;
      assetType?: AssetType;
      quantity?: number;
      amountRial?: number;
      weightPct?: number;
      reasonFa: string;
    },
  ) {
    const { latest, portfolio } = await this.requireOwnedLatestSnapshot(userId, portfolioId);
    const symbol = this.canonicalSuggestionSymbol(act.symbol, act.assetType);
    const current = latest.items.find((i) => foldFa(i.symbol) === foldFa(symbol));
    let action = act.action;
    if (action === 'ADD' && current) action = 'INCREASE';
    if ((action === 'INCREASE' || action === 'DECREASE' || action === 'SET') && !current) {
      action = 'ADD';
    }
    if (action === 'REMOVE') {
      return this.removeItem(userId, portfolioId, current?.symbol ?? symbol);
    }

    const assetType =
      act.assetType ??
      current?.assetType ??
      this.inferSuggestionAssetType(symbol);
    const priced = await this.latestPriceForSymbol(symbol, assetType);
    const size = this.suggestionTradeSize(priced.price, portfolio.capitalRial, act);

    let quantity: number;
    let amountRial: number;
    if (action === 'ADD' || action === 'SET') {
      quantity = size.quantity;
      amountRial = size.amountRial;
    } else if (action === 'INCREASE') {
      quantity = (current?.quantity ?? 0) + size.quantity;
      amountRial = (current?.amountRial ?? 0) + size.amountRial;
    } else {
      quantity = Math.max(0, (current?.quantity ?? 0) - size.quantity);
      amountRial = Math.max(0, (current?.amountRial ?? 0) - size.amountRial);
    }

    if (quantity <= 1e-9 || amountRial <= 1e-6) {
      return this.removeItem(userId, portfolioId, current?.symbol ?? symbol);
    }

    const prevQty = current?.quantity ?? 0;
    const prevAvg = current?.avgBuyPrice ?? current?.unitPrice ?? priced.price;
    const avgBuyPrice = this.nextAvgBuyPrice(prevQty, prevAvg, quantity, priced.price);
    const reasonFa = act.reasonFa || current?.reasonFa || 'اعمال پیشنهاد آنالیز';

    const row = {
      symbol,
      assetType,
      quantity,
      amountRial,
      unitPrice: priced.price,
      avgBuyPrice,
      reasonFa,
      instrumentId: priced.instrumentId ?? current?.instrumentId ?? undefined,
    };

    const rows = current
      ? latest.items.map((i) => (foldFa(i.symbol) === foldFa(symbol) ? row : this.holdingFromItem(i)))
      : [...latest.items.map((i) => this.holdingFromItem(i)), row];

    const eventType =
      action === 'DECREASE' ? PortfolioEventType.SELL : PortfolioEventType.BUY;

    return this.writeHoldingsSnapshot(portfolioId, latest, rows, {
      type: eventType,
      payload: {
        fromAnalysis: true,
        action,
        symbol,
        quantity,
        amountRial,
      },
      noteFa: `اعمال پیشنهاد: ${act.reasonFa}`,
    });
  }

  private suggestionTradeSize(
    price: number,
    capitalRial: number,
    data: { quantity?: number; amountRial?: number; weightPct?: number },
  ) {
    if (data.amountRial != null && data.amountRial > 0) {
      return this.resolveQtyAndAmount(price, undefined, data.amountRial);
    }
    if (data.weightPct != null && data.weightPct > 0) {
      return this.resolveQtyAndAmount(price, undefined, (data.weightPct / 100) * capitalRial);
    }
    if (data.quantity != null && data.quantity > 0) {
      return this.resolveQtyAndAmount(price, data.quantity, undefined);
    }
    throw new BadRequestException('مقدار این پیشنهاد برای اعمال مشخص نیست.');
  }

  private canonicalSuggestionSymbol(symbol: string, assetType?: AssetType) {
    const t = symbol.trim();
    if (assetType === AssetType.PHYSICAL_GOLD || /^PHYSICAL_GOLD$/i.test(t)) return 'PHYSICAL_GOLD';
    if (assetType === AssetType.PHYSICAL_USD || /^PHYSICAL_USD$/i.test(t)) return 'PHYSICAL_USD';
    return t;
  }

  private inferSuggestionAssetType(symbol: string): AssetType {
    const t = foldFa(symbol);
    if (t === foldFa('PHYSICAL_GOLD') || /طلای?\s*فیزیکی/.test(t)) return AssetType.PHYSICAL_GOLD;
    if (t === foldFa('PHYSICAL_USD') || /دلار\s*فیزیکی/.test(t)) return AssetType.PHYSICAL_USD;
    return AssetType.STOCK;
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

    const ai = await this.users.aiAccess(userId);
    if (!ai.portfolio) return this.get(userId, portfolioId);
    return this.rebalance(userId, portfolioId, 'بازچینش پس از تغییر نقد/فروش', { skipBilling: true });
  }

  private materializeItems(
    items: Array<{ symbol: string; assetType: AssetType; weightPct: number; reasonFa: string }>,
    capital: number,
    universe: Array<{ id: string; symbol: string; assetType: AssetType; lastPrice: number | null }>,
  ) {
    const capitalSafe = Math.max(0, Math.round(Number(capital) || 0));
    if (capitalSafe <= 0 || !items?.length) return [];

    type Prep = {
      symbol: string;
      assetType: AssetType;
      weight: number;
      reasonFa: string;
    };

    const prepared: Prep[] = [];
    for (const raw of items) {
      const normalized = this.normalizePhysicalAsset(
        String(raw.symbol ?? ''),
        raw.assetType ?? AssetType.STOCK,
      );
      const weight = Math.max(0, Number(raw.weightPct) || 0);
      if (!normalized.symbol || weight <= 0) continue;
      prepared.push({
        symbol: normalized.symbol,
        assetType: normalized.assetType,
        weight,
        reasonFa: raw.reasonFa || 'انتخاب بر اساس استراتژی',
      });
    }
    if (!prepared.length) return [];

    const weightSum = prepared.reduce((s, i) => s + i.weight, 0) || 100;

    type Row = {
      symbol: string;
      assetType: AssetType;
      weightPct: number;
      quantity: number;
      amountRial: number;
      unitPrice: number;
      avgBuyPrice: number;
      reasonFa: string;
      instrumentId?: string;
    };

    const rows: Row[] = [];
    let allocated = 0;

    for (const i of prepared) {
      const remainingBudget = capitalSafe - allocated;
      if (remainingBudget <= 0) break;

      const targetWeight = i.weight / weightSum;
      let targetAmount = Math.floor(targetWeight * capitalSafe);
      targetAmount = Math.min(targetAmount, remainingBudget);
      if (targetAmount <= 0) continue;

      const u = universe.find(
        (x) => x.symbol === i.symbol || x.symbol.trim() === i.symbol.trim(),
      );
      const price = u?.lastPrice != null && u.lastPrice > 0 ? u.lastPrice : null;
      const needsMarketPrice =
        i.assetType === AssetType.STOCK ||
        i.assetType === AssetType.GOLD_ETF ||
        i.assetType === AssetType.OPTION ||
        i.assetType === AssetType.FUND;

      let quantity = 0;
      let amountRial = 0;
      let unitPrice = price ?? 0;

      if (price && needsMarketPrice) {
        // فقط تعداد صحیح قابل خرید در سقف بودجهٔ این سهم و کل سرمایه
        quantity = Math.floor(targetAmount / price);
        if (quantity < 1) continue; // یک واحد از بودجهٔ تخصیصی گران‌تر است → رد
        amountRial = quantity * price;
        if (amountRial > remainingBudget) {
          quantity = Math.floor(remainingBudget / price);
          if (quantity < 1) continue;
          amountRial = quantity * price;
        }
        unitPrice = price;
      } else if (
        i.assetType === AssetType.PHYSICAL_GOLD ||
        i.assetType === AssetType.PHYSICAL_USD ||
        i.assetType === AssetType.DEPOSIT ||
        i.assetType === AssetType.CASH
      ) {
        // تخصیص مبلغی بدون الزام به قیمت تابلو
        amountRial = targetAmount;
        unitPrice = price && price > 0 ? price : 1;
        quantity = unitPrice > 0 ? amountRial / unitPrice : 0;
      } else if (price) {
        quantity = Math.floor(targetAmount / price);
        if (quantity < 1) continue;
        amountRial = quantity * price;
        unitPrice = price;
      } else {
        // بدون قیمت معتبر برای سهم → وارد سبد نکن (از قیمت جعلی ۱ استفاده نکن)
        continue;
      }

      if (amountRial <= 0) continue;
      allocated += amountRial;
      rows.push({
        symbol: i.symbol,
        assetType: i.assetType,
        weightPct: 0, // بعداً از مبلغ نهایی محاسبه می‌شود
        quantity,
        amountRial,
        unitPrice,
        avgBuyPrice: unitPrice,
        reasonFa: i.reasonFa,
        instrumentId: u?.id && !u.id.startsWith('synthetic-') ? u.id : undefined,
      });
    }

    // اگر به‌خاطر رند کردن تعداد، جمع از سرمایه رد شد (نباید رخ دهد) مقیاس کن
    const sumAmounts = rows.reduce((s, r) => s + r.amountRial, 0);
    if (sumAmounts > capitalSafe && sumAmounts > 0) {
      let left = capitalSafe;
      for (let idx = 0; idx < rows.length; idx++) {
        const r = rows[idx];
        if (idx === rows.length - 1) {
          if (r.unitPrice > 0 && (r.assetType === AssetType.STOCK || r.assetType === AssetType.GOLD_ETF || r.assetType === AssetType.OPTION || r.assetType === AssetType.FUND)) {
            const q = Math.floor(left / r.unitPrice);
            r.quantity = q;
            r.amountRial = q * r.unitPrice;
          } else {
            r.amountRial = Math.max(0, left);
            r.quantity = r.unitPrice > 0 ? r.amountRial / r.unitPrice : 0;
          }
        } else {
          const share = r.amountRial / sumAmounts;
          let amt = Math.floor(share * capitalSafe);
          if (r.unitPrice > 0 && (r.assetType === AssetType.STOCK || r.assetType === AssetType.GOLD_ETF || r.assetType === AssetType.OPTION || r.assetType === AssetType.FUND)) {
            const q = Math.floor(amt / r.unitPrice);
            r.quantity = q;
            r.amountRial = q * r.unitPrice;
          } else {
            r.amountRial = amt;
            r.quantity = r.unitPrice > 0 ? r.amountRial / r.unitPrice : 0;
          }
          left -= r.amountRial;
        }
      }
    }

    let finalAllocated = rows.reduce((s, r) => s + r.amountRial, 0);
    // ماندهٔ مصرف‌نشده به‌صورت نقد در سبد
    const leftover = capitalSafe - finalAllocated;
    if (leftover > 0) {
      const existingCash = rows.find((r) => r.assetType === AssetType.CASH || r.symbol === 'CASH');
      if (existingCash) {
        existingCash.amountRial += leftover;
        existingCash.quantity = existingCash.amountRial;
        existingCash.unitPrice = 1;
        existingCash.avgBuyPrice = 1;
      } else {
        rows.push({
          symbol: 'CASH',
          assetType: AssetType.CASH,
          weightPct: 0,
          quantity: leftover,
          amountRial: leftover,
          unitPrice: 1,
          avgBuyPrice: 1,
          reasonFa: 'ماندهٔ نقد پس از تخصیص قابل‌خرید',
        });
      }
      finalAllocated = capitalSafe;
    }

    return rows
      .filter((r) => r.amountRial > 0)
      .map((r) => ({
        ...r,
        weightPct: finalAllocated > 0 ? (r.amountRial / capitalSafe) * 100 : 0,
      }));
  }

  private normalizePhysicalAsset(symbol: string, assetType: AssetType) {
    const s = symbol.trim();
    if (
      assetType === AssetType.PHYSICAL_GOLD ||
      /طلای?\s*فیزیکی|PHYSICAL_GOLD/i.test(s)
    ) {
      return { symbol: 'PHYSICAL_GOLD', assetType: AssetType.PHYSICAL_GOLD };
    }
    if (
      assetType === AssetType.PHYSICAL_USD ||
      /دلار\s*فیزیکی|PHYSICAL_USD/i.test(s)
    ) {
      return { symbol: 'PHYSICAL_USD', assetType: AssetType.PHYSICAL_USD };
    }
    return { symbol: s, assetType };
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

    const stockWeight = strategy === PortfolioStrategy.CONSERVATIVE ? 40 : 55;
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
        weightPct: 15,
        reasonFa: 'پوشش تورمی با صندوق طلا',
      });
    }
    items.push({
      symbol: 'PHYSICAL_GOLD',
      assetType: AssetType.PHYSICAL_GOLD,
      weightPct: 10,
      reasonFa: 'پوشش تورمی با طلای فیزیکی',
    });
    items.push({
      symbol: 'PHYSICAL_USD',
      assetType: AssetType.PHYSICAL_USD,
      weightPct: 10,
      reasonFa: 'پوشش ارزی با دلار فیزیکی',
    });
    if (deposit) {
      items.push({
        symbol: deposit.symbol,
        assetType: AssetType.DEPOSIT,
        weightPct: gold ? 10 : 25,
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
      where: { isActive: true, assetType: { not: AssetType.INDEX }, ...(await visibleInstrumentsWhere(this.prisma)) },
      take: 200,
      include: { priceBars: { orderBy: { tradeDate: 'desc' }, take: 1 } },
    });
    const [macro, spot] = await Promise.all([
      this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } }),
      this.prisma.spotPriceDaily.findFirst({ orderBy: { dateKey: 'desc' } }),
    ]);
    const usdIrr =
      (spot?.usdIrr && spot.usdIrr > 0 ? spot.usdIrr : null) ??
      (macro?.usdIrr && macro.usdIrr > 0 ? macro.usdIrr : null) ??
      600000;
    const goldGramRial =
      spot?.goldGramRial && spot.goldGramRial > 0 ? spot.goldGramRial : usdIrr * 75;

    const list = instruments.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      nameFa: i.nameFa,
      assetType: i.assetType,
      lastPrice: i.priceBars[0]?.lastPrice ?? i.priceBars[0]?.closePrice ?? null,
      eps: i.priceBars[0]?.eps ?? null,
      pe: i.priceBars[0]?.pe ?? null,
    }));

    list.push(
      {
        id: 'synthetic-physical-gold',
        symbol: 'PHYSICAL_GOLD',
        nameFa: 'طلای فیزیکی',
        assetType: AssetType.PHYSICAL_GOLD,
        lastPrice: goldGramRial,
        eps: null,
        pe: null,
      },
      {
        id: 'synthetic-physical-usd',
        symbol: 'PHYSICAL_USD',
        nameFa: 'دلار فیزیکی',
        assetType: AssetType.PHYSICAL_USD,
        lastPrice: usdIrr,
        eps: null,
        pe: null,
      },
    );

    return list;
  }
}
