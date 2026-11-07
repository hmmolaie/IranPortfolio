import { Injectable, Logger } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { MarketService } from '../market/market.service';
import {
  STOCKS_PER_CALL,
  compactStockFacts,
  readNoul,
  screenQuestions,
  screenState,
  type MarketState,
  type StockFact,
} from './suggest-system-one';
import { attachStockSignals } from './stock-signals';

const SCREEN_PURPOSE = 'portfolio_stock_screen';
/** غربال قدیمی‌تر از این برای پیشنهاد استفاده نمی‌شود و غربال تازه همان لحظه ساخته می‌شود. */
const SCREEN_MAX_AGE_DAYS = 7;
/** اگر بیش از این سهم از دسته‌ها خطا بدهند غربال ذخیره نمی‌شود. */
const MAX_FAILED_SHARE = 0.3;
const RETRY_AFTER_MS = 2 * 60 * 60_000;
const MAX_ATTEMPTS_PER_DAY = 3;

export type ScreenScores = { tradeDate: Date; scores: Map<string, number> };

/**
 * غربال روزانهٔ سهم‌ها با System One. به‌جای اینکه هر کاربر کل بازار را از مدل بپرسد،
 * بعد از اینجست شبانه یک‌بار همهٔ سهم‌ها امتیاز می‌گیرند و هر پیشنهاد فقط سهم‌های برتر را با پروفایل کاربر می‌سنجد.
 */
@Injectable()
export class StockScreenService {
  private readonly logger = new Logger(StockScreenService.name);
  private readonly inFlight = new Map<string, Promise<ScreenScores>>();
  private readonly attempts = new Map<string, { count: number; lastAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly market: MarketService,
  ) {}

  /** تازه‌ترین غربال تا همان روز معاملاتی، اگر از هفت روز قدیمی‌تر نباشد. */
  async latest(tradeDate: Date): Promise<ScreenScores | null> {
    const since = new Date(tradeDate.getTime() - SCREEN_MAX_AGE_DAYS * 86_400_000);
    const newest = await this.prisma.stockScreenDaily.findFirst({
      where: { tradeDate: { gte: since, lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (!newest) return null;
    const rows = await this.prisma.stockScreenDaily.findMany({
      where: { tradeDate: newest.tradeDate },
      select: { symbol: true, probability: true },
    });
    return { tradeDate: newest.tradeDate, scores: new Map(rows.map((row) => [row.symbol, row.probability])) };
  }

  async has(tradeDate: Date): Promise<boolean> {
    const row = await this.prisma.stockScreenDaily.findFirst({ where: { tradeDate }, select: { id: true } });
    return Boolean(row);
  }

  /** اینجست سهام همان روز تمام شده و بعد از آخرین میلهٔ سهم ثبت شده است. */
  async ingestSettled(tradeDate: Date): Promise<boolean> {
    if (this.market.ingestRunning) return false;
    const [status, newestBar] = await Promise.all([
      this.prisma.marketIngestStatus.findUnique({ where: { id: 'latest' } }),
      this.prisma.priceBar.findFirst({
        where: { tradeDate, instrument: { assetType: AssetType.STOCK } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    if (!status?.ok || !status.finishedAt || !newestBar) return false;
    return status.finishedAt >= newestBar.createdAt;
  }

  /** غربال‌های قدیمی؛ نگه‌داشتن چند ماه برای سنجش بعدی کیفیت پیشنهادها کافی است. */
  async prune(keepDays = 180) {
    const before = new Date(Date.now() - keepDays * 86_400_000);
    await this.prisma.stockScreenDaily.deleteMany({ where: { tradeDate: { lt: before } } });
  }

  /** کرون: اگر چند بار پشت سر هم خطا داده، تا دو ساعت دوباره صدا نمی‌زند. */
  canRetry(tradeDate: Date): boolean {
    const state = this.attempts.get(tradeDate.toISOString());
    if (!state) return true;
    return state.count < MAX_ATTEMPTS_PER_DAY && Date.now() - state.lastAt >= RETRY_AFTER_MS;
  }

  /** یک غربال برای هر روز؛ درخواست همزمان منتظر همان اجرای قبلی می‌ماند. */
  run(tradeDate: Date, stocks: StockFact[], market: MarketState): Promise<ScreenScores> {
    const key = tradeDate.toISOString();
    const running = this.inFlight.get(key);
    if (running) return running;
    const job = this.screen(tradeDate, stocks, market)
      .catch((e) => {
        const state = this.attempts.get(key) ?? { count: 0, lastAt: 0 };
        this.attempts.set(key, { count: state.count + 1, lastAt: Date.now() });
        throw e;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, job);
    return job;
  }

  private async screen(tradeDate: Date, stocks: StockFact[], market: MarketState): Promise<ScreenScores> {
    const started = Date.now();
    await attachStockSignals(this.prisma, stocks, tradeDate);
    const batches: StockFact[][] = [];
    for (let offset = 0; offset < stocks.length; offset += STOCKS_PER_CALL) {
      batches.push(stocks.slice(offset, offset + STOCKS_PER_CALL));
    }
    const scored: Array<{ stock: StockFact; probability: number }> = [];
    let failed = 0;
    let lastError: unknown = null;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const answers = await this.llm.systemOne(undefined, SCREEN_PURPOSE, screenState(market, batch), screenQuestions(batch));
        batch.forEach((stock, index) => scored.push({ stock, probability: readNoul(answers[`p${index}`]) }));
      } catch (e) {
        failed += 1;
        lastError = e;
        // اگر سه دستهٔ اول همه خطا بدهند، مشکل از تنظیمات مدل است نه یک دسته.
        if (i === 2 && failed === 3) break;
      }
    }
    if (!scored.length || failed > batches.length * MAX_FAILED_SHARE) {
      const reason = lastError instanceof Error ? lastError.message : 'خطای نامشخص';
      throw new Error(`غربال روزانهٔ سهام ناموفق بود (${failed} از ${batches.length} دسته): ${reason}`);
    }
    await this.prisma.$transaction([
      this.prisma.stockScreenDaily.deleteMany({ where: { tradeDate } }),
      this.prisma.stockScreenDaily.createMany({
        data: scored.map(({ stock, probability }) => ({
          tradeDate,
          symbol: stock.symbol,
          probability,
          facts: compactStockFacts(stock),
        })),
        skipDuplicates: true,
      }),
    ]);
    this.logger.log(
      `غربال سهام ${tradeDate.toISOString().slice(0, 10)}: ${scored.length} نماد، ${batches.length} فراخوانی، ${failed} خطا، ${Math.round((Date.now() - started) / 1000)} ثانیه`,
    );
    return { tradeDate, scores: new Map(scored.map(({ stock, probability }) => [stock.symbol, probability])) };
  }
}
