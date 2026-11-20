import { BadRequestException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AssetType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObservedErrorService } from '../common/observed-error.service';
import { readRefreshSchedule } from '../content-refresh/refresh-schedule';
import { tehranDateKey, tehranTimeParts } from '../news/tehran-date';
import { describeCodalError } from '../market/codal';
import { FundamentalsService } from './fundamentals.service';
import {
  CODAL_MAX_PAGES,
  addJalaliDays,
  codalStatementListPageUrl,
  codalSymbolKey,
  downloadCodalExcel,
  fetchCodalStatementPage,
  formatJalaliDate,
  jalaliKey,
  jalaliOf,
  monthWindowEnd,
  parseJalaliDate,
  tehranTodayJalali,
  type CodalStatementLetter,
  type JalaliDate,
} from './codal-statements';

const CONFIG_ID = 'default';
/** بازهٔ پیش‌فرض همان نمونهٔ فیلتر کدال */
const DEFAULT_FROM = '1405/01/01';
/** هر صفحهٔ فهرست تا این تعداد بار دوباره خوانده می‌شود؛ بعد کار تا نوبت فردا متوقف می‌شود */
const PAGE_ATTEMPTS = 3;
const PAGE_RETRY_DELAY_MS = 20_000;
/** این تعداد دانلود ناموفق پشت‌سرهم یعنی کدال در دسترس نیست؛ کار تا نوبت فردا متوقف می‌شود */
const MAX_CONSECUTIVE_DOWNLOAD_FAILS = 5;
const BETWEEN_REQUESTS_MS = 1_500;
const OBSERVED_PURPOSE = 'codal_statements';

export type CodalRunItemStatus = 'queued' | 'downloading' | 'analyzing' | 'done' | 'duplicate' | 'skipped' | 'failed';

export type CodalRunItem = {
  tracingNo: number;
  symbol: string;
  titleFa: string;
  publishedAtFa: string;
  status: CodalRunItemStatus;
  messageFa: string | null;
  instrumentId: string | null;
  statementId: string | null;
};

export type CodalRunStatus = 'running' | 'ok' | 'stopped_ai' | 'stopped_crawl' | 'failed';

export type CodalRunState = {
  trigger: 'auto' | 'manual';
  fromDateFa: string;
  toDateFa: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: CodalRunStatus;
  messageFa: string | null;
  pagesRead: number;
  items: CodalRunItem[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errText(e: unknown): string {
  return ((e as Error)?.message || String(e) || 'خطای نامشخص').slice(0, 600);
}

function maxDate(...dates: Array<JalaliDate | null>): JalaliDate | null {
  let best: JalaliDate | null = null;
  for (const d of dates) if (d && (!best || jalaliKey(d) > jalaliKey(best))) best = d;
  return best;
}

/**
 * همگام‌سازی صورت‌های مالی از کدال: فهرست اطلاعیه‌های بازهٔ تاریخ را از جستجوی کدال می‌خواند،
 * اکسل هر اطلاعیه را دانلود و مثل بارگذاری دستی ادمین برای همان سهم آنالیز می‌کند.
 * هر روز در ساعت «صورت‌های مالی کدال» تنظیمات ساعت به‌روزرسانی، یا دستی از تنظیمات ادمین.
 */
@Injectable()
export class CodalStatementSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CodalStatementSyncService.name);
  private current: CodalRunState | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fundamentals: FundamentalsService,
    private readonly observed: ObservedErrorService,
  ) {}

  /** اجرایی که با ری‌استارت نیمه‌کاره ماند در سوابق «متوقف» دیده شود */
  async onApplicationBootstrap() {
    try {
      await this.prisma.codalStatementSync.updateMany({
        where: { lastRunStatus: 'running' },
        data: { lastRunStatus: 'failed', lastRunMessage: 'سرویس وسط اجرا ری‌استارت شد', lastRunFinishedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`وضعیت همگام‌سازی کدال: ${(e as Error).message}`);
    }
  }

  async getConfig() {
    const existing = await this.prisma.codalStatementSync.findUnique({ where: { id: CONFIG_ID } });
    if (existing) return existing;
    const from = parseJalaliDate(DEFAULT_FROM) as JalaliDate;
    return this.prisma.codalStatementSync.create({
      data: { id: CONFIG_ID, fromDateFa: DEFAULT_FROM, toDateFa: formatJalaliDate(monthWindowEnd(from)) },
    });
  }

  /** وضعیت برای صفحهٔ تنظیمات ادمین */
  async status() {
    const [config, schedule] = await Promise.all([this.getConfig(), readRefreshSchedule(this.prisma)]);
    return {
      fromDateFa: config.fromDateFa,
      toDateFa: config.toDateFa,
      lastPublishedFa: config.lastPublishedFa,
      lastRunAt: config.lastRunAt,
      lastRunFinishedAt: config.lastRunFinishedAt,
      lastRunTrigger: config.lastRunTrigger,
      lastRunStatus: config.lastRunStatus,
      lastRunMessage: config.lastRunMessage,
      codalHour: schedule.codalHour,
      codalMinute: schedule.codalMinute,
      listPageUrl: codalStatementListPageUrl(config.fromDateFa, config.toDateFa),
      running: this.running,
      run: this.current,
    };
  }

  /** بازه‌ای که ادمین وارد کرده؛ اجرای خودکار بعدی هم از همین بازه است */
  async saveWindow(fromRaw: string, toRaw: string) {
    const from = parseJalaliDate(fromRaw);
    const to = parseJalaliDate(toRaw);
    if (!from || !to) throw new BadRequestException('تاریخ را به شکل ۱۴۰۵/۰۱/۰۱ وارد کنید');
    if (jalaliKey(to) < jalaliKey(from)) throw new BadRequestException('تاریخ پایان باید بعد از تاریخ شروع باشد');
    await this.getConfig();
    await this.prisma.codalStatementSync.update({
      where: { id: CONFIG_ID },
      data: { fromDateFa: formatJalaliDate(from), toDateFa: formatJalaliDate(to) },
    });
    return this.status();
  }

  /** اجرای دستی با بازهٔ ادمین؛ پاسخ فوری است و پیشرفت از وضعیت خوانده می‌شود */
  async runManual(fromRaw?: string, toRaw?: string) {
    if (this.running) throw new BadRequestException('همگام‌سازی کدال همین حالا در حال اجراست');
    if (fromRaw || toRaw) await this.saveWindow(fromRaw ?? '', toRaw ?? '');
    const config = await this.getConfig();
    void this.run('manual', config.fromDateFa, config.toDateFa).catch((e) =>
      this.logger.error(`همگام‌سازی دستی کدال: ${errText(e)}`),
    );
    return this.status();
  }

  /** هر دقیقه با ساعت تنظیم‌شده مقایسه می‌شود؛ هر روز فقط یک‌بار */
  @Cron('* * * * *', { timeZone: 'Asia/Tehran', name: 'codal-statements-tick' })
  async scheduledTick() {
    if (this.running) return;
    try {
      const schedule = await readRefreshSchedule(this.prisma);
      const now = tehranTimeParts();
      if (now.hour !== schedule.codalHour || now.minute !== schedule.codalMinute) return;
      const today = tehranDateKey();
      const config = await this.getConfig();
      if (config.lastAutoDateKey === today) return;
      await this.prisma.codalStatementSync.update({ where: { id: CONFIG_ID }, data: { lastAutoDateKey: today } });
      await this.run('auto', config.fromDateFa, config.toDateFa);
    } catch (e) {
      this.logger.error(`همگام‌سازی خودکار کدال: ${errText(e)}`);
    }
  }

  // ---------------------------------------------------------------- اجرا

  private async run(trigger: 'auto' | 'manual', fromDateFa: string, toDateFa: string) {
    if (this.running) return;
    this.running = true;
    const state: CodalRunState = {
      trigger,
      fromDateFa,
      toDateFa,
      startedAt: new Date(),
      finishedAt: null,
      status: 'running',
      messageFa: null,
      pagesRead: 0,
      items: [],
    };
    this.current = state;
    await this.prisma.codalStatementSync.update({
      where: { id: CONFIG_ID },
      data: {
        lastRunAt: state.startedAt,
        lastRunFinishedAt: null,
        lastRunTrigger: trigger,
        lastRunStatus: 'running',
        lastRunMessage: null,
      },
    });

    let lastSuccess: { day: JalaliDate; publishedAtFa: string; publishedAt: Date | null } | null = null;
    try {
      const letters = await this.crawlList(state);
      if (letters) {
        state.items = letters.map((l) => ({
          tracingNo: l.tracingNo,
          symbol: l.symbol,
          titleFa: l.titleFa,
          publishedAtFa: l.publishedAtFa,
          status: 'queued',
          messageFa: null,
          instrumentId: null,
          statementId: null,
        }));
        lastSuccess = await this.processLetters(state, letters);
        if (state.status === 'running') {
          state.status = 'ok';
          const done = state.items.filter((i) => i.status === 'done').length;
          state.messageFa = `${letters.length} اطلاعیه در بازه بود؛ ${done} صورت مالی دانلود و آنالیز شد.`;
        }
      }
    } catch (e) {
      state.status = 'failed';
      state.messageFa = `همگام‌سازی کدال با خطا تمام شد: ${errText(e)}`;
      await this.observed.record({ purpose: OBSERVED_PURPOSE, message: state.messageFa, detail: (e as Error)?.stack });
    } finally {
      state.finishedAt = new Date();
      for (const item of state.items) {
        if (item.status === 'queued' || item.status === 'downloading' || item.status === 'analyzing') {
          item.status = 'skipped';
          item.messageFa = item.messageFa ?? 'به‌خاطر توقف کار بررسی نشد';
        }
      }
      await this.finish(state, lastSuccess).catch((e) => this.logger.error(`ذخیرهٔ نتیجهٔ کدال: ${errText(e)}`));
      this.running = false;
    }
  }

  /** همهٔ صفحه‌های فهرست بازه؛ اگر یک صفحه پس از چند تلاش خوانده نشد null و کار متوقف می‌شود */
  private async crawlList(state: CodalRunState): Promise<CodalStatementLetter[] | null> {
    const byTracing = new Map<number, CodalStatementLetter>();
    let pageCount = 1;
    for (let page = 1; page <= Math.min(pageCount, CODAL_MAX_PAGES); page += 1) {
      let lastError = '';
      let ok = false;
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt += 1) {
        try {
          const res = await fetchCodalStatementPage(state.fromDateFa, state.toDateFa, page);
          for (const l of res.letters) byTracing.set(l.tracingNo, l);
          pageCount = res.pageCount;
          state.pagesRead = page;
          ok = true;
          break;
        } catch (e) {
          lastError = describeCodalError(e);
          this.logger.warn(`فهرست کدال صفحهٔ ${page} تلاش ${attempt}: ${lastError}`);
          if (attempt < PAGE_ATTEMPTS) await sleep(PAGE_RETRY_DELAY_MS);
        }
      }
      if (!ok) {
        state.status = 'stopped_crawl';
        state.messageFa = `خواندن فهرست کدال (صفحهٔ ${page}) پس از ${PAGE_ATTEMPTS} تلاش ناموفق بود؛ کار متوقف شد و نوبت بعد فردا در ساعت تنظیم‌شده است. دلیل: ${lastError}`;
        await this.observed.record({ purpose: OBSERVED_PURPOSE, message: state.messageFa });
        return null;
      }
      if (page < pageCount) await sleep(BETWEEN_REQUESTS_MS);
    }
    // قدیمی به جدید، تا «آخرین انتشار آنالیزشده» همیشه جلو برود
    return [...byTracing.values()].sort((a, b) => a.publishedKey - b.publishedKey || a.tracingNo - b.tracingNo);
  }

  private async processLetters(state: CodalRunState, letters: CodalStatementLetter[]) {
    const instruments = await this.prisma.instrument.findMany({
      where: { assetType: AssetType.STOCK },
      select: { id: true, symbol: true, isActive: true },
    });
    const bySymbol = new Map<string, { id: string; symbol: string }>();
    for (const inst of instruments) {
      const key = codalSymbolKey(inst.symbol);
      if (!bySymbol.has(key) || inst.isActive) bySymbol.set(key, inst);
    }

    let lastSuccess: { day: JalaliDate; publishedAtFa: string; publishedAt: Date | null } | null = null;
    let downloadFails = 0;
    for (let i = 0; i < letters.length; i += 1) {
      const letter = letters[i];
      const item = state.items[i];
      const inst = bySymbol.get(codalSymbolKey(letter.symbol));
      if (!inst) {
        item.status = 'skipped';
        item.messageFa = 'این نماد به‌عنوان سهم در سامانه نیست';
        continue;
      }
      item.instrumentId = inst.id;

      const recorded = await this.fundamentals.isCodalNoticeRecorded(
        letter.tracingNo,
        inst.id,
        letter.titleFa,
        letter.publishedAtFa,
      );
      if (recorded) {
        item.status = 'duplicate';
        item.messageFa = recorded;
        continue;
      }
      if (!letter.excelUrl) {
        item.status = 'skipped';
        item.messageFa = 'این اطلاعیه فایل اکسل ندارد';
        continue;
      }

      item.status = 'downloading';
      let buffer: Buffer | null = null;
      let downloadError = '';
      for (let attempt = 1; attempt <= 2 && !buffer; attempt += 1) {
        try {
          buffer = await downloadCodalExcel(letter.excelUrl);
        } catch (e) {
          downloadError = describeCodalError(e);
          if (attempt < 2) await sleep(BETWEEN_REQUESTS_MS * 2);
        }
      }
      if (!buffer) {
        item.status = 'skipped';
        item.messageFa = `دانلود اکسل ناموفق بود: ${downloadError}`;
        downloadFails += 1;
        if (downloadFails >= MAX_CONSECUTIVE_DOWNLOAD_FAILS) {
          state.status = 'stopped_crawl';
          state.messageFa = `${downloadFails} دانلود پشت‌سرهم از کدال ناموفق بود؛ کار متوقف شد و نوبت بعد فردا در ساعت تنظیم‌شده است. آخرین خطا: ${downloadError}`;
          await this.observed.record({ purpose: OBSERVED_PURPOSE, message: state.messageFa });
          break;
        }
        continue;
      }
      downloadFails = 0;

      item.status = 'analyzing';
      const result = await this.fundamentals.ingestCodalStatement({
        instrumentId: inst.id,
        symbol: inst.symbol,
        tracingNo: letter.tracingNo,
        noticeTitle: letter.titleFa,
        publishedAtFa: letter.publishedAtFa,
        buffer,
      });
      item.statementId = result.statementId ?? null;
      if (result.status === 'done') {
        item.status = 'done';
        item.messageFa = null;
        const day = parseJalaliDate(letter.publishedAtFa);
        if (day) {
          lastSuccess = { day, publishedAtFa: letter.publishedAtFa, publishedAt: letter.publishedAt };
          await this.recordLastPublished(lastSuccess);
        }
      } else if (result.status === 'duplicate') {
        item.status = 'duplicate';
        item.messageFa = result.error ?? 'قبلاً ثبت شده';
      } else if (result.stage === 'model') {
        // خطای هوش مصنوعی: کار ادامه پیدا نمی‌کند
        item.status = 'failed';
        item.messageFa = `خطای هوش مصنوعی: ${result.error ?? 'نامشخص'}`;
        state.status = 'stopped_ai';
        state.messageFa = `آنالیز صورت مالی «${letter.symbol}» (${letter.titleFa}) با خطای هوش مصنوعی روبه‌رو شد و همگام‌سازی کدال متوقف شد. خطا: ${result.error ?? 'نامشخص'}`;
        await this.observed.record({ purpose: OBSERVED_PURPOSE, message: state.messageFa });
        break;
      } else {
        // فایل خوانده نشد یا پاسخ مدل رقمی نداشت: همین ردیف کنار می‌رود
        item.status = 'failed';
        item.messageFa = result.error ?? 'آنالیز ناموفق';
      }
      await sleep(BETWEEN_REQUESTS_MS);
    }
    return lastSuccess;
  }

  private async recordLastPublished(s: { day: JalaliDate; publishedAtFa: string; publishedAt: Date | null }) {
    const config = await this.getConfig();
    const prev = config.lastPublishedFa ? parseJalaliDate(config.lastPublishedFa) : null;
    if (prev && jalaliKey(prev) > jalaliKey(s.day)) return;
    if (prev && jalaliKey(prev) === jalaliKey(s.day) && config.lastPublishedFa! > s.publishedAtFa) return;
    await this.prisma.codalStatementSync.update({
      where: { id: CONFIG_ID },
      data: { lastPublishedFa: s.publishedAtFa, lastPublishedAt: s.publishedAt },
    });
  }

  /**
   * نتیجه را ذخیره و بازهٔ بعدی را می‌سازد: شروع، فردای آخرین انتشار آنالیزشده است و پایان یک ماه بعد.
   * اگر کار وسط بازه متوقف شد، از همان روز آخرین انتشار (تا اطلاعیه‌های باقی‌ماندهٔ همان روز جا نمانند).
   * اگر بازه کامل در گذشته بود و همه بررسی شد، از روز بعد از پایان بازه، تا کار روی بازهٔ خالی گیر نکند.
   * بازه هیچ‌وقت عقب‌تر از شروع فعلی نمی‌رود.
   */
  private async finish(
    state: CodalRunState,
    runSuccess: { day: JalaliDate; publishedAtFa: string; publishedAt: Date | null } | null,
  ) {
    const config = await this.getConfig();
    const currentFrom = parseJalaliDate(config.fromDateFa);
    const runTo = parseJalaliDate(state.toDateFa);
    const lastDay = config.lastPublishedAt ? jalaliOf(config.lastPublishedAt) : parseJalaliDate(config.lastPublishedFa);
    const stopped = state.status !== 'ok';
    const today = tehranTodayJalali();

    const afterLast = stopped && runSuccess ? runSuccess.day : lastDay ? addJalaliDays(lastDay, 1) : null;
    const afterWindow = !stopped && runTo && jalaliKey(runTo) < jalaliKey(today) ? addJalaliDays(runTo, 1) : null;
    const nextFrom = maxDate(currentFrom, afterLast, afterWindow) ?? currentFrom;

    await this.prisma.codalStatementSync.update({
      where: { id: CONFIG_ID },
      data: {
        ...(nextFrom
          ? { fromDateFa: formatJalaliDate(nextFrom), toDateFa: formatJalaliDate(monthWindowEnd(nextFrom)) }
          : {}),
        lastRunFinishedAt: state.finishedAt,
        lastRunStatus: state.status,
        lastRunMessage: state.messageFa?.slice(0, 2000) ?? null,
      },
    });
  }
}
