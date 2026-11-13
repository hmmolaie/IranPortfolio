import { Injectable, Logger } from '@nestjs/common';
import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateKey } from '../news/tehran-date';
import {
  codalReportListUrl,
  describeCodalError,
  fetchCodalLetterText,
  fetchCodalLetters,
  fetchTsetmcCodalLetters,
  type CodalLetter,
} from './codal';

/** نمادهایی که در کدال اطلاعیه دارند */
const CODAL_ASSET_TYPES = new Set<AssetType>([AssetType.STOCK, AssetType.FUND, AssetType.GOLD_ETF]);
const RETRY_AFTER_FAIL_MS = 2 * 60 * 1000;
const TEXT_CONCURRENCY = 3;

export type CodalNoticesDto = {
  symbol: string;
  supported: boolean;
  sourceUrl: string | null;
  fetchedAt: Date | null;
  /** واکشی امروز ناموفق بود و فهرست از روز قبل است */
  stale: boolean;
  errorFa: string | null;
  items: Array<{
    tracingNo: number;
    titleFa: string;
    letterCode: string | null;
    publishedAtFa: string;
    url: string;
    hasHtml: boolean;
    bodyText: string | null;
  }>;
};

@Injectable()
export class CodalService {
  private readonly logger = new Logger(CodalService.name);
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly failedAt = new Map<string, number>();
  private readonly failReason = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** ده اطلاعیهٔ آخر نماد. هر نماد در هر روز تهران فقط یک‌بار از کدال خوانده می‌شود. */
  async getNotices(instrumentId: string): Promise<CodalNoticesDto | null> {
    const inst = await this.prisma.instrument.findUnique({
      where: { id: instrumentId },
      select: { symbol: true, assetType: true, insCode: true },
    });
    if (!inst) return null;
    const symbol = inst.symbol.trim();
    if (!symbol || !CODAL_ASSET_TYPES.has(inst.assetType)) {
      return {
        symbol,
        supported: false,
        sourceUrl: null,
        fetchedAt: null,
        stale: false,
        errorFa: null,
        items: [],
      };
    }

    const today = tehranDateKey();
    let state = await this.prisma.codalNoticeFetch.findUnique({ where: { symbol } });
    let errorFa: string | null = null;

    if (state?.dateKey !== today) {
      const lastFail = this.failedAt.get(symbol) ?? 0;
      if (Date.now() - lastFail < RETRY_AFTER_FAIL_MS) {
        errorFa = `واکشی از کدال چند دقیقه پیش ناموفق بود؛ کمی بعد دوباره تلاش می‌شود. دلیل: ${
          this.failReason.get(symbol) ?? 'نامشخص'
        }`;
      } else {
        try {
          await this.crawlOnce(symbol, today, inst.insCode);
          this.failedAt.delete(symbol);
          state = await this.prisma.codalNoticeFetch.findUnique({ where: { symbol } });
        } catch (e) {
          this.failedAt.set(symbol, Date.now());
          const reason = describeCodalError(e);
          this.failReason.set(symbol, reason);
          this.logger.warn(`کدال ${symbol}: ${reason}`);
          errorFa = `الان اتصال به کدال برقرار نشد. دلیل: ${reason}`;
        }
      }
    }

    const rows = await this.prisma.codalNotice.findMany({
      where: { symbol },
      orderBy: { sortOrder: 'asc' },
      select: {
        tracingNo: true,
        titleFa: true,
        letterCode: true,
        publishedAtFa: true,
        url: true,
        hasHtml: true,
        bodyText: true,
      },
    });

    return {
      symbol,
      supported: true,
      sourceUrl: codalReportListUrl(symbol),
      fetchedAt: state?.fetchedAt ?? null,
      stale: Boolean(state) && state?.dateKey !== today,
      errorFa,
      items: rows,
    };
  }

  /** دو درخواست همزمان برای یک نماد فقط یک کرال می‌سازند */
  private crawlOnce(symbol: string, dateKey: string, insCode: string | null): Promise<void> {
    const running = this.inFlight.get(symbol);
    if (running) return running;
    const job = this.crawl(symbol, dateKey, insCode).finally(() => this.inFlight.delete(symbol));
    this.inFlight.set(symbol, job);
    return job;
  }

  /**
   * اول خود کدال؛ اگر وصل نشد (کدال آی‌پی بیرون ایران را نمی‌پذیرد) همان فهرست از tsetmc.
   * در حالت دوم متن اطلاعیه خوانده نمی‌شود چون صفحهٔ متن هم روی codal.ir است.
   */
  private async loadLetters(
    symbol: string,
    insCode: string | null,
  ): Promise<{ letters: CodalLetter[]; canReadText: boolean }> {
    try {
      return { letters: await fetchCodalLetters(symbol), canReadText: true };
    } catch (e) {
      if (!insCode) throw e;
      const codalReason = describeCodalError(e);
      try {
        const letters = await fetchTsetmcCodalLetters(insCode);
        this.logger.warn(`کدال ${symbol}: ${codalReason}؛ فهرست از tsetmc خوانده شد`);
        return { letters, canReadText: false };
      } catch (e2) {
        throw new Error(`${codalReason} — tsetmc هم: ${describeCodalError(e2)}`);
      }
    }
  }

  private async crawl(symbol: string, dateKey: string, insCode: string | null): Promise<void> {
    const { letters, canReadText } = await this.loadLetters(symbol, insCode);
    const fetchedAt = new Date();

    // متن اطلاعیه‌ای که قبلاً خوانده شده عوض نمی‌شود؛ دوباره کرال نمی‌شود
    const known = await this.prisma.codalNotice.findMany({
      where: { symbol, tracingNo: { in: letters.map((l) => l.tracingNo) } },
      select: { tracingNo: true, bodyText: true },
    });
    const knownText = new Map(known.map((k) => [k.tracingNo, k.bodyText]));

    const bodies = new Map<number, string | null>();
    const pending = letters.filter((l) => {
      const saved = knownText.get(l.tracingNo);
      if (saved) {
        bodies.set(l.tracingNo, saved);
        return false;
      }
      return canReadText && l.hasHtml;
    });
    for (let i = 0; i < pending.length; i += TEXT_CONCURRENCY) {
      await Promise.all(
        pending.slice(i, i + TEXT_CONCURRENCY).map(async (letter: CodalLetter) => {
          try {
            bodies.set(letter.tracingNo, await fetchCodalLetterText(letter));
          } catch (e) {
            this.logger.warn(
              `متن اطلاعیهٔ کدال ${symbol} ${letter.tracingNo}: ${(e as Error).message.slice(0, 120)}`,
            );
          }
        }),
      );
    }

    await this.prisma.$transaction([
      this.prisma.codalNotice.deleteMany({ where: { symbol } }),
      this.prisma.codalNotice.createMany({
        data: letters.map((l, idx) => ({
          symbol,
          tracingNo: l.tracingNo,
          titleFa: l.titleFa,
          letterCode: l.letterCode,
          publishedAtFa: l.publishedAtFa,
          url: l.url,
          hasHtml: l.hasHtml,
          bodyText: bodies.get(l.tracingNo) ?? null,
          sortOrder: idx,
          fetchedAt,
        })),
      }),
      this.prisma.codalNoticeFetch.upsert({
        where: { symbol },
        create: { symbol, dateKey, fetchedAt },
        update: { dateKey, fetchedAt },
      }),
    ]);
    this.logger.log(`کدال ${symbol}: ${letters.length} اطلاعیه برای ${dateKey} ذخیره شد`);
  }
}
