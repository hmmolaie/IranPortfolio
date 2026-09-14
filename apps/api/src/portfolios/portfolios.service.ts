import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  AssetType,
  PortfolioEventType,
  PortfolioStrategy,
  SnapshotKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { NewsService } from '../news/news.service';
import { UsersService } from '../users/users.service';
import { daysAgoDateKey } from '../news/tehran-date';

@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly news: NewsService,
    private readonly users: UsersService,
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
        }>;
      }>;
    },
  >(portfolio: T) {
    const universe = await this.buildUniverse();
    const lastBySymbol = new Map(
      universe.map((u) => [u.symbol.trim(), u.lastPrice] as const),
    );

    return {
      ...portfolio,
      snapshots: portfolio.snapshots.map((snap) => ({
        ...snap,
        items: snap.items.map((item) => {
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
          const pnlRial =
            avgBuyPrice != null && lastPrice != null ? (lastPrice - avgBuyPrice) * qty : 0;

          return {
            ...item,
            avgBuyPrice,
            lastPrice,
            costBasisRial,
            marketValueRial,
            pnlRial,
            /** ارزش روز برای وزن٪ و جمع تخصیص */
            amountRial: marketValueRial,
          };
        }),
      })),
    };
  }

  async create(
    userId: string,
    data: { name: string; strategy: PortfolioStrategy; capitalRial: number; description?: string },
  ) {
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
      await this.suggest(userId, portfolio.id, { initialCreate: true });
    } catch {
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
    options?: { initialCreate?: boolean },
  ) {
    const strategies = await this.suggestStrategies(userId, portfolioId, options);
    const first = strategies.strategies[0];
    if (!first) {
      return this.createSnapshotFromItems(userId, portfolioId, {
        strategySummaryFa: 'پیشنهاد خالی',
        items: [],
      });
    }
    return this.createSnapshotFromItems(userId, portfolioId, first);
  }

  async suggestStrategies(
    userId: string,
    portfolioId: string,
    options?: { initialCreate?: boolean },
  ) {
    const portfolio = await this.get(userId, portfolioId);
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const platformUserId = (await this.users.getAdminUserId()) ?? userId;
    const universe = await this.buildUniverse();
    const macro = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const funds = await this.prisma.fundReport.findMany({
      where: { userId: platformUserId, useInSuggestions: true },
      orderBy: { rating: 'desc' },
      take: 8,
    });
    const fundInsights = await this.prisma.fundTimelineInsight.findMany({
      where: { userId: platformUserId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const lessons = await this.prisma.lesson.findMany({
      where: { userId: platformUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const economicNews = await this.news.getForPortfolioContext(userId, 40, 30);
    const fxHistory = await this.prisma.spotPriceDaily.findMany({
      where: { dateKey: { gte: daysAgoDateKey(30) } },
      orderBy: { dateKey: 'asc' },
      select: { dateKey: true, usdIrr: true, goldGramRial: true },
      take: 35,
    });
    const fundReportIds = funds.map((f) => f.id);
    const fundHoldingsRaw =
      fundReportIds.length > 0
        ? await this.prisma.fundHolding.findMany({
            where: { fundReportId: { in: fundReportIds } },
            orderBy: [{ weightPct: 'desc' }, { amountRial: 'desc' }],
            take: 120,
            include: {
              fundReport: { select: { fundName: true, reportMonth: true } },
            },
          })
        : [];

    const system = await this.llm.getSystemPrompt(userId, 'portfolio_suggest_multi');

    const userPrompt = JSON.stringify(
      {
        capitalRial: portfolio.capitalRial,
        capitalRialFormatted: portfolio.capitalRial.toLocaleString('en-US'),
        strategy: portfolio.strategy,
        preferencesNoteFa: portfolio.preferencesNoteFa,
        userProfile: profile,
        hardConstraints: {
          maxTotalRial: portfolio.capitalRial,
          weightPctMeaning:
            'weightPct درصد از سرمایه (capitalRial) است؛ مجموع weightPct هر استراتژی باید دقیقاً حدود ۱۰۰ باشد',
          doNotExceedCapital: true,
          quantityRule:
            'تعداد سهم را خودت حساب نکن؛ فقط وزن درصدی بده. سیستم بر اساس قیمت و سرمایه تعداد قابل‌خرید می‌سازد و جمع مبلغ از سرمایه بیشتر نمی‌شود',
        },
        universe: universe.slice(0, 80).map((u) => ({
          symbol: u.symbol,
          nameFa: u.nameFa,
          assetType: u.assetType,
          lastPrice: u.lastPrice,
          pe: u.pe,
        })),
        macro,
        economicNews: economicNews.map((n) => ({
          date: n.batch.newsDateKey,
          title: n.titleFa,
          summary: n.summaryFa,
          marketImpact: n.marketImpactFa,
          direction: n.impactDirection,
          relevance: n.relevanceScore,
          sectors: n.sectorsFa,
          category: n.category,
          opportunityKind: n.opportunityKind,
          participateHow: n.participateHowFa,
          deadline: n.deadlineFa,
          officialSource: n.officialSourceFa,
          isRetailActionable: n.isRetailActionable,
        })),
        fxHistory,
        topFunds: funds.map((f) => ({
          fundName: f.fundName,
          month: f.reportMonth,
          rating: f.rating,
          managerTechnicalScore: f.managerTechnicalScore,
          riskAppetiteScore: f.riskAppetiteScore,
          professionalismScore: f.professionalismScore,
          guessedStrategyFa: f.guessedStrategyFa,
        })),
        fundHoldings: fundHoldingsRaw.map((h) => ({
          fundName: h.fundReport.fundName,
          month: h.fundReport.reportMonth,
          symbol: h.symbol,
          nameFa: h.nameFa,
          assetKind: h.assetKind,
          action: h.action,
          weightPct: h.weightPct,
          amountRial: h.amountRial,
        })),
        fundTimelineInsights: fundInsights.map((i) => ({
          summaryFa: i.summaryFa,
          strategyChangeFa: i.strategyChangeFa,
          holdingsDiffFa: i.holdingsDiffFa,
          llmReasoningFa: i.llmReasoningFa,
        })),
        lessons: lessons.map((l) => ({ title: l.titleFa, body: l.bodyFa })),
        instruction: options?.initialCreate
          ? `این ایجاد اولیه سبد است. سرمایه کل ${portfolio.capitalRial} ریال و استراتژی ${portfolio.strategy} است.
فقط weightPct بده (جمع ≈ ۱۰۰). جمع ارزش سبد نباید از ${portfolio.capitalRial} ریال بیشتر شود.
سهامی پیشنهاد نکن که قیمت یک واحدش از سهم بودجه‌اش بیشتر باشد.
حتماً lessons، fundHoldings (موجودی/خرید/فروش صندوق‌ها)، economicNews (~۳۰ روز) و fxHistory (دلار/طلا ~۳۰ روز) را در تصمیم و در reasonFa/strategySummaryFa منعکس کن.
PHYSICAL_GOLD / PHYSICAL_USD در صورت مناسب بودن مجاز است.`
          : `چند استراتژی متفاوت پیشنهاد بده. سرمایه کل ${portfolio.capitalRial} ریال است.
weightPct فقط درصد از همین سرمایه است (جمع هر استراتژی ≈ ۱۰۰). ارزش کل هر استراتژی مساوی همین سرمایه است و نباید بیشتر شود.
حتماً lessons، fundHoldings، economicNews (~۳۰ روز) و fxHistory را لحاظ کن و در توضیحات ارجاع بده.`,
      },
      null,
      2,
    );

    type Out = {
      strategies: Array<{
        labelFa: string;
        strategySummaryFa: string;
        items: Array<{
          symbol: string;
          assetType: AssetType;
          weightPct: number;
          reasonFa: string;
        }>;
      }>;
    };

    try {
      const out = await this.llm.chatJson<Out>('portfolio_suggest_multi', system, userPrompt, userId);
      if (out.strategies?.length) return out;
    } catch {
      /* fallback */
    }

    const single = this.fallbackSuggest(universe, portfolio.strategy);
    return {
      strategies: [
        {
          labelFa: 'پیشنهاد قاعده‌محور',
          strategySummaryFa: single.strategySummaryFa,
          items: single.items,
        },
        {
          labelFa: 'محافظه‌کار با سپرده بیشتر',
          strategySummaryFa: 'کاهش ریسک سهام و افزایش سپرده/طلا',
          items: single.items.map((i) =>
            i.assetType === AssetType.STOCK
              ? { ...i, weightPct: i.weightPct * 0.7, reasonFa: i.reasonFa + ' (کاهش ریسک)' }
              : i,
          ),
        },
      ],
    };
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
    const universe = await this.buildUniverse();
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

    const context = `سبد: ${portfolio.name}
استراتژی: ${portfolio.strategy}
سرمایه: ${portfolio.capitalRial}
آخرین پیشنهاد: ${latest?.strategySummaryFa ?? 'ندارد'}
نمادها: ${latest?.items.map((i) => `${i.symbol}(${i.weightPct}%)`).join('، ') ?? ''}
علاقه‌مندی کاربر: ${profile?.investmentPreferencesFa ?? ''}
محدودیت‌ها: ${profile?.constraintsFa ?? ''}
یادداشت سبد: ${portfolio.preferencesNoteFa ?? ''}`;

    const historyText = history
      .map((m) => `${m.role === 'user' ? 'کاربر' : 'دستیار'}: ${m.contentFa}`)
      .join('\n');

    let reply: string;
    try {
      const chatSystem = await this.llm.getSystemPrompt(userId, 'portfolio_chat');
      reply = await this.llm.chatText(
        'portfolio_chat',
        chatSystem,
        `${context}

یادآوری محدوده: فقط به سؤالات مالی مربوط به همین سبد پاسخ بده. اگر سؤال نامرتبط بود، رد کن و به محدودهٔ سبد برگردان.

گفتگو:
${historyText}`,
        userId,
      );
    } catch (e) {
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
      weightPct: number;
      reasonFa?: string;
    },
  ) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('ابتدا یک پیشنهاد یا اسنپ‌شات بسازید');

    const symbol = data.symbol.trim();
    if (!symbol) throw new NotFoundException('نماد نامعتبر است');
    if (latest.items.some((i) => i.symbol === symbol)) {
      throw new BadRequestException('این نماد از قبل در سبد هست');
    }

    const remaining = Math.max(0, 100 - data.weightPct);
    const currentTotal = latest.items.reduce((s, i) => s + i.weightPct, 0) || 100;
    const scaled = latest.items.map((i) => ({
      symbol: i.symbol,
      weightPct: currentTotal ? (i.weightPct / currentTotal) * remaining : 0,
      quantity: undefined as number | undefined,
      assetType: i.assetType,
      reasonFa: i.reasonFa,
    }));

    scaled.push({
      symbol,
      weightPct: data.weightPct,
      quantity: undefined,
      assetType: data.assetType,
      reasonFa: data.reasonFa ?? 'افزودن دستی توسط کاربر',
    });

    const snapshot = await this.adjustWeights(userId, portfolioId, scaled, { skipEvent: true });
    await this.prisma.portfolioEvent.create({
      data: {
        portfolioId,
        type: PortfolioEventType.BUY,
        payload: { symbol, weightPct: data.weightPct, assetType: data.assetType },
        noteFa: `افزودن نماد ${symbol}`,
      },
    });
    return snapshot;
  }

  async removeItem(userId: string, portfolioId: string, symbol: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('نسخه‌ای برای ویرایش نیست');

    const remaining = latest.items.filter((i) => i.symbol !== symbol);
    if (remaining.length === latest.items.length) {
      throw new NotFoundException('نماد در سبد یافت نشد');
    }
    if (remaining.length === 0) {
      throw new BadRequestException('حداقل یک نماد باید در سبد بماند');
    }

    const total = remaining.reduce((s, i) => s + i.weightPct, 0) || 100;
    const items = remaining.map((i) => ({
      symbol: i.symbol,
      weightPct: (i.weightPct / total) * 100,
      assetType: i.assetType,
      reasonFa: i.reasonFa,
    }));

    const snapshot = await this.adjustWeights(userId, portfolioId, items, { skipEvent: true });
    await this.prisma.portfolioEvent.create({
      data: {
        portfolioId,
        type: PortfolioEventType.SELL,
        payload: { symbol },
        noteFa: `حذف نماد ${symbol}`,
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
    const totalValue = rawItems.reduce((s, i) => s + (Number(i.amountRial) || 0), 0);
    const items = rawItems
      .map((i) => {
        const amountRial = Number(i.amountRial) || 0;
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
    if (latest) {
      try {
        analysis = await this.analyzeCurrent(userId, main.id);
      } catch (e) {
        analysis = {
          score: 50,
          summaryFa: `آنالیز امروز در دسترس نبود. (${(e as Error).message.slice(0, 120)})`,
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

  async analyzeCurrent(userId: string, portfolioId: string) {
    const portfolio = await this.get(userId, portfolioId);
    const latest = portfolio.snapshots[0];
    if (!latest) throw new NotFoundException('سبدی برای آنالیز وجود ندارد');

    const universe = await this.buildUniverse();
    const macro = await this.prisma.macroSnapshot.findFirst({ orderBy: { asOfDate: 'desc' } });
    const economicNews = await this.news.getForPortfolioContext(userId, 40, 30);
    const fxHistory = await this.prisma.spotPriceDaily.findMany({
      where: { dateKey: { gte: daysAgoDateKey(30) } },
      orderBy: { dateKey: 'asc' },
      select: { dateKey: true, usdIrr: true, goldGramRial: true },
      take: 35,
    });
    const platformUserId = (await this.users.getAdminUserId()) ?? userId;
    const lessons = await this.prisma.lesson.findMany({
      where: { userId: platformUserId },
      orderBy: { createdAt: 'desc' },
      take: 15,
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

    const system = await this.llm.getSystemPrompt(userId, 'portfolio_analyze');
    const userPrompt = JSON.stringify(
      {
        portfolio: {
          name: portfolio.name,
          strategy: portfolio.strategy,
          capitalRial: portfolio.capitalRial,
          cashRial: portfolio.cashRial,
          preferencesNoteFa: portfolio.preferencesNoteFa,
        },
        userProfile: profile,
        currentItems: pricedItems,
        macro,
        economicNews: economicNews.map((n) => ({
          date: n.batch.newsDateKey,
          title: n.titleFa,
          summary: n.summaryFa,
          marketImpact: n.marketImpactFa,
          direction: n.impactDirection,
          relevance: n.relevanceScore,
          sectors: n.sectorsFa,
          category: n.category,
          opportunityKind: n.opportunityKind,
          participateHow: n.participateHowFa,
          deadline: n.deadlineFa,
          officialSource: n.officialSourceFa,
          isRetailActionable: n.isRetailActionable,
        })),
        fxHistory,
        lessons: lessons.map((l) => ({ title: l.titleFa, body: l.bodyFa })),
      },
      null,
      2,
    );

    type AnalysisOut = {
      score: number;
      summaryFa: string;
      strengthsFa: string[];
      weaknessesFa: string[];
      suggestions: Array<{ titleFa: string; bodyFa: string; priority?: string }>;
    };

    let analysis: AnalysisOut;
    try {
      analysis = await this.llm.chatJson<AnalysisOut>(
        'portfolio_analyze',
        system,
        userPrompt,
        userId,
      );
    } catch (e) {
      analysis = {
        score: 55,
        summaryFa: `آنالیز خودکار بدون LLM: ترکیب فعلی را با اخبار و قیمت روز بررسی کنید. (${(e as Error).message.slice(0, 80)})`,
        strengthsFa: ['وجود تخصیص ثبت‌شده در سبد'],
        weaknessesFa: ['دسترسی به مدل زبانی برای تحلیل عمیق‌تر برقرار نشد'],
        suggestions: [
          {
            titleFa: 'بررسی مجدد وزن‌ها',
            bodyFa: 'وزن سهام، طلا و نقد را با شرایط تورمی و اخبار روز تطبیق دهید.',
            priority: 'medium',
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
      suggestions: analysis.suggestions ?? [],
      analyzedAt: new Date().toISOString(),
    };
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
      where: { isActive: true, assetType: { not: AssetType.INDEX } },
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
