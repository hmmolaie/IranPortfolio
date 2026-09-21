import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { normalizeIranMobile } from '../common/iran-mobile';
import { tehranDateKey, tehranDateWithWeekdayFa, tehranTimeParts, tehranWeekday } from '../news/tehran-date';
import { PortfoliosService } from '../portfolios/portfolios.service';
import { NewsService } from '../news/news.service';
import { replaceSocialNetworkBrandFa } from '../llm/social-source-wording';
import { UsersService } from '../users/users.service';
import { LlmService } from '../llm/llm.service';
import { renderPortfolioPiePng } from './pie-chart-png';
import { fallbackDigestVoiceScript, trimSpokenScript } from './digest-voice';
import {
  DEFAULT_TELEGRAM_BOT_NAME_FA,
  DEFAULT_TELEGRAM_BOT_URL,
  DEFAULT_TELEGRAM_BOT_USERNAME,
  resolveTelegramBotUsername,
} from './constants';

type NewsItemRow = {
  titleFa: string;
  summaryFa: string;
  marketImpactFa?: string | null;
  category?: string | null;
  opportunityKind?: string | null;
  participateHowFa?: string | null;
  deadlineFa?: string | null;
  officialSourceFa?: string | null;
  isRetailActionable?: boolean | null;
  relevanceScore?: number | null;
};

type NewsBatchRow = {
  newsDateKey: string;
  summaryFa?: string | null;
  items: NewsItemRow[];
};

type TelegramUpdate = {
  update_id: number;
  message?: {
    from?: { id: number };
    chat: { id: number; username?: string };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
};

const CONFIG_ID = 'default';
const DEFAULT_DIGEST_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const TG_API = 'https://api.telegram.org';
/** فقط صداهای زنانه؛ اگر TTS_VOICE چیز دیگری بود nova استفاده می‌شود */
const FEMALE_TTS_VOICES = new Set(['nova', 'shimmer', 'coral', 'sage']);
const DIGEST_TTS_INSTRUCTIONS =
  'Speak as an Iranian woman news presenter. Fluent contemporary Iranian Persian, not Dari. Warm, clear, natural pace. Past-tense reporting. Do not rush; keep the whole briefing under two minutes.';

const STRATEGY_FA: Record<string, string> = {
  GROWTH: 'رشدی',
  VALUE: 'ارزشی',
  INCOME: 'درآمدی / سود تقسیمی',
  HEDGED: 'پوششی',
  CONSERVATIVE: 'محافظه‌کار',
  CUSTOM: 'سفارشی',
};

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private pollInFlight = false;
  private sendInFlight = false;
  private skippedBacklog = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly portfolios: PortfoliosService,
    private readonly news: NewsService,
    private readonly users: UsersService,
    private readonly llm: LlmService,
  ) {}

  onModuleInit() {
    void this.ensureCanonicalBotUsername();
    if (process.env.NODE_ENV !== 'production') return;
    setTimeout(() => {
      void this.catchUpIfNeeded();
    }, 25_000);
  }

  private encKey() {
    return this.config.get<string>('LLM_TOKEN_ENCRYPTION_KEY') ?? '0123456789abcdef0123456789abcdef';
  }

  private resolveBotUsername(stored?: string | null) {
    return resolveTelegramBotUsername(stored);
  }

  private resolveBotNameFa(stored?: string | null) {
    return (stored ?? '').trim() || DEFAULT_TELEGRAM_BOT_NAME_FA;
  }

  private botDeepLink() {
    return DEFAULT_TELEGRAM_BOT_URL;
  }

  /** اگر قبلاً حساب @sabadyaar ذخیره شده، به ربات @sabadyaar_bot اصلاح می‌شود */
  private async ensureCanonicalBotUsername() {
    try {
      const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
      if (!row) return;
      const botUsername = this.resolveBotUsername(row.botUsername);
      if (row.botUsername === botUsername) return;
      await this.prisma.telegramBotConfig.update({
        where: { id: CONFIG_ID },
        data: { botUsername },
      });
    } catch (e) {
      this.logger.warn(`اصلاح نام کاربری ربات: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  async getPublicConfig() {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    const linkedCount = await this.prisma.userProfile.count({
      where: { telegramChatId: { not: null }, mobilePhone: { not: null } },
    });
    const lastDigest = await this.prisma.telegramDigestLog.findFirst({
      orderBy: { dateKey: 'desc' },
    });
    const botUsername = this.resolveBotUsername(row?.botUsername);
    return {
      botNameFa: this.resolveBotNameFa(row?.botNameFa),
      botUsername,
      deepLink: this.botDeepLink(),
      enabled: row?.enabled ?? true,
      ttsModel: this.resolveDigestTtsModel(row?.ttsModel),
      ...this.scheduleFrom(row),
      hasToken: Boolean(row?.botTokenEncrypted),
      linkedCount,
      lastDigest,
    };
  }

  async getUserStatus(userId: string) {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    const profile = await this.prisma.userProfile.findUnique({ where: { userId } });
    const username = this.resolveBotUsername(row?.botUsername);
    const configured = Boolean(row?.botTokenEncrypted && row.enabled !== false);
    return {
      configured,
      enabled: row?.enabled ?? false,
      botNameFa: this.resolveBotNameFa(row?.botNameFa),
      botUsername: username,
      deepLink: this.botDeepLink(),
      mobilePhone: profile?.mobilePhone ?? null,
      linked: Boolean(profile?.telegramChatId),
      telegramUsername: profile?.telegramUsername ?? null,
      ...this.scheduleFrom(row),
    };
  }

  async saveConfig(data: {
    botNameFa?: string;
    botUsername?: string;
    botToken?: string;
    enabled?: boolean;
    ttsModel?: string;
    sendHour?: number;
    sendMinute?: number;
    sendWeekdays?: number[];
  }) {
    const current = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    let botUsername = this.resolveBotUsername(
      data.botUsername ?? current?.botUsername ?? DEFAULT_TELEGRAM_BOT_USERNAME,
    );
    if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
      throw new BadRequestException('نام کاربری ربات نامعتبر است (بدون @، فقط حروف و عدد و _)');
    }
    const botNameFa =
      (data.botNameFa ?? current?.botNameFa ?? DEFAULT_TELEGRAM_BOT_NAME_FA).trim() ||
      DEFAULT_TELEGRAM_BOT_NAME_FA;
    let botTokenEncrypted = current?.botTokenEncrypted ?? null;
    if (data.botToken?.trim()) {
      const token = data.botToken.trim();
      if (token.length < 30 || !token.includes(':')) {
        throw new BadRequestException('توکن ربات نامعتبر است (از BotFather کپی کنید)');
      }
      botTokenEncrypted = encryptSecret(this.encKey(), token);
    }
    const enabled = data.enabled ?? current?.enabled ?? true;
    const ttsModel = this.resolveDigestTtsModel(data.ttsModel ?? current?.ttsModel);
    const schedule = this.resolveSchedule(data, current);

    return this.prisma.telegramBotConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        botNameFa,
        botUsername,
        botTokenEncrypted,
        enabled,
        ttsModel,
        sendHour: schedule.hour,
        sendMinute: schedule.minute,
        sendWeekdays: schedule.weekdays,
      },
      update: {
        botNameFa,
        botUsername,
        botTokenEncrypted,
        enabled,
        ttsModel,
        sendHour: schedule.hour,
        sendMinute: schedule.minute,
        sendWeekdays: schedule.weekdays,
        ...(data.botToken?.trim() ? { lastUpdateId: null } : {}),
      },
    }).then(async () => {
      this.skippedBacklog = false;
      return this.getPublicConfig();
    });
  }

  async testConnection() {
    const token = await this.readToken();
    if (!token) throw new BadRequestException('ابتدا توکن ربات را ذخیره کنید');
    const me = await this.tg<{ username?: string; first_name?: string }>(token, 'getMe');
    return {
      ok: true,
      messageFa: 'اتصال به ربات برقرار است.',
      botUsername: me.username ?? '',
      botName: me.first_name ?? '',
    };
  }

  async unlink(userId: string) {
    await this.prisma.userProfile.updateMany({
      where: { userId },
      data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
    });
    return { ok: true };
  }

  /** هر دقیقه ساعت تهران را با روزها و ساعت ذخیره‌شده مقایسه می‌کند */
  @Cron('* * * * *', { timeZone: 'Asia/Tehran', name: 'telegram-digest-tick' })
  async scheduledDigestTick() {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!row?.enabled) return;
    const schedule = this.scheduleFrom(row);
    const now = tehranTimeParts();
    const weekday = tehranWeekday();
    if (!this.isSendSlot(now, weekday, schedule)) return;
    this.logger.log(
      `ارسال زمان‌بندی‌شده تلگرام (${String(schedule.sendHour).padStart(2, '0')}:${String(schedule.sendMinute).padStart(2, '0')} تهران)`,
    );
    await this.deliverToday({ force: false });
  }

  async catchUpIfNeeded() {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!row?.enabled) return;
    const schedule = this.scheduleFrom(row);
    const now = tehranTimeParts();
    if (!this.isSendSlot(now, tehranWeekday(), schedule, 'passed')) return;
    await this.deliverToday({ force: false });
  }

  /**
   * ارسال دستی ادمین. کار سنگین است (آنالیز هر کاربر + ساخت صوت)، پس در پس‌زمینه می‌رود
   * تا درخواست HTTP پشت پروکسی تایم‌اوت نشود؛ نتیجه در TelegramDigestLog می‌نشیند.
   */
  async startDeliverToday(force: boolean) {
    if (this.sendInFlight) {
      return { ok: false, messageFa: 'ارسال قبلی هنوز تمام نشده است.' };
    }
    const token = await this.readToken();
    const cfg = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!cfg?.enabled || !token) {
      return { ok: false, messageFa: 'ربات تلگرام پیکربندی نشده یا غیرفعال است.' };
    }

    void this.deliverToday({ force }).catch(async (e) => {
      const reason = `ارسال ناتمام ماند: ${(e as Error).message.slice(0, 200)}`;
      this.logger.error(reason);
      try {
        await this.upsertLog(tehranDateKey(), 0, 0, reason);
      } catch {
        /* لاگ ناموفق را نادیده بگیر */
      }
    });

    return {
      ok: true,
      messageFa:
        'ارسال شروع شد. ساخت آنالیز و فایل صوتی چند دقیقه طول می‌کشد؛ نتیجه در «آخرین ارسال» همین صفحه می‌آید.',
    };
  }

  async deliverToday(opts: { force?: boolean; batch?: NewsBatchRow | null }) {
    if (this.sendInFlight) {
      return { ok: false, messageFa: 'ارسال قبلی هنوز تمام نشده است.' };
    }
    this.sendInFlight = true;
    try {
      const dateKey = tehranDateKey();
      if (!opts.force) {
        const already = await this.prisma.telegramDigestLog.findUnique({ where: { dateKey } });
        if (already && already.sentCount > 0) {
          return { ok: true, messageFa: 'پیام امروز قبلاً ارسال شده است.', ...already };
        }
      }

      const cfg = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
      const token = await this.readToken();
      if (!cfg?.enabled || !token) {
        await this.upsertLog(dateKey, 0, 0, 'ربات غیرفعال است یا توکن ذخیره نشده');
        return { ok: false, messageFa: 'ربات تلگرام پیکربندی نشده یا غیرفعال است.' };
      }

      let batch =
        opts.batch ??
        (await this.prisma.economicNewsBatch.findFirst({
          where: { newsDateKey: dateKey },
          orderBy: { createdAt: 'desc' },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        }));
      if (!batch?.items?.length) {
        const adminId = await this.users.getAdminUserId();
        if (adminId) {
          try {
            batch = await this.news.refresh(adminId, { persistEmpty: false });
          } catch (e) {
            this.logger.warn(`رفرش اخبار قبل از تلگرام ناموفق: ${(e as Error).message.slice(0, 160)}`);
          }
        }
      }

      const recipients = await this.prisma.userProfile.findMany({
        where: {
          telegramChatId: { not: null },
          mobilePhone: { not: null },
          user: { isActive: true },
        },
        select: { telegramChatId: true, userId: true },
      });
      if (!recipients.length) {
        await this.upsertLog(dateKey, 0, 0, 'هیچ کاربری ربات را با موبایل پروفایل وصل نکرده');
        return { ok: false, messageFa: 'کاربر متصل به ربات یافت نشد.' };
      }

      const newsText = this.formatNewsSection(cfg.botNameFa, batch);
      const newsVoice = await this.sharedNewsVoice(dateKey, cfg.botNameFa, batch);
      let sentCount = 0;
      let failedCount = 0;
      for (const r of recipients) {
        if (!r.telegramChatId) continue;
        try {
          await this.sendPersonalized(token, r.telegramChatId, r.userId, newsText, newsVoice);
          sentCount += 1;
        } catch (e) {
          failedCount += 1;
          this.logger.warn(
            `ارسال تلگرام به ${r.userId} ناموفق: ${(e as Error).message.slice(0, 160)}`,
          );
        }
        await sleep(80);
      }
      const log = await this.upsertLog(dateKey, sentCount, failedCount, null);
      this.logger.log(`تلگرام ${dateKey}: ارسال ${sentCount}، ناموفق ${failedCount}`);
      return { ok: sentCount > 0, messageFa: `ارسال شد: ${sentCount} موفق، ${failedCount} ناموفق`, ...log };
    } finally {
      this.sendInFlight = false;
    }
  }

  @Interval(4000)
  async pollUpdates() {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const token = await this.readToken();
      const cfg = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
      if (!token || !cfg?.enabled) return;

      const offset = cfg.lastUpdateId ? Number(cfg.lastUpdateId) + 1 : undefined;
      const updates = await this.tg<TelegramUpdate[]>(token, 'getUpdates', {
        offset,
        timeout: 0,
        allowed_updates: ['message'],
      });
      if (!Array.isArray(updates) || updates.length === 0) return;

      const maxId = Math.max(...updates.map((u) => u.update_id));
      if (!cfg.lastUpdateId && !this.skippedBacklog) {
        this.skippedBacklog = true;
        await this.prisma.telegramBotConfig.update({
          where: { id: CONFIG_ID },
          data: { lastUpdateId: String(maxId) },
        });
        return;
      }

      for (const u of updates) {
        await this.handleUpdate(token, cfg.botNameFa, u);
      }
      await this.prisma.telegramBotConfig.update({
        where: { id: CONFIG_ID },
        data: { lastUpdateId: String(maxId) },
      });
    } catch (e) {
      this.logger.warn(`poll تلگرام: ${(e as Error).message.slice(0, 180)}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async handleUpdate(token: string, botNameFa: string | null, update: TelegramUpdate) {
    const msg = update.message;
    if (!msg?.chat?.id) return;
    const chatId = String(msg.chat.id);
    const username = msg.chat.username ?? null;
    const text = (msg.text ?? '').trim();
    const contact = msg.contact;

    if (text === '/stop') {
      await this.prisma.userProfile.updateMany({
        where: { telegramChatId: chatId },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      });
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'اتصال تلگرام سبدیار قطع شد. برای وصل دوباره /start را بزنید.',
      });
      return;
    }

    if (contact?.phone_number) {
      if (contact.user_id && msg.from?.id && contact.user_id !== msg.from.id) {
        await this.tg(token, 'sendMessage', {
          chat_id: chatId,
          text: 'فقط شمارهٔ موبایل خودتان را بفرستید.',
        });
        return;
      }
      const profile = await this.findProfileByMobile(contact.phone_number);
      if (!profile) {
        await this.tg(token, 'sendMessage', {
          chat_id: chatId,
          text: 'این شماره در پروفایل سبدیار ثبت نشده. اول موبایل را در تنظیمات سایت ذخیره کنید، بعد دوباره شماره را بفرستید.',
        });
        return;
      }
      await this.prisma.userProfile.updateMany({
        where: { telegramChatId: chatId, NOT: { id: profile.id } },
        data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
      });
      await this.prisma.userProfile.update({
        where: { id: profile.id },
        data: {
          telegramChatId: chatId,
          telegramUsername: username,
          telegramLinkedAt: new Date(),
        },
      });
      const name = this.resolveBotNameFa(botNameFa);
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `اتصال برقرار شد. در روزها و ساعتی که در تنظیمات مشخص شده، نمودار سبد، پیشنهاد بهبود، خلاصهٔ اخبار ${name} و فایل صوتی فارسی همان اخبار برایتان می‌آید.`,
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    if (text.startsWith('/start') || text === '/link') {
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'برای دریافت خلاصهٔ روزانه، همان موبایلی که در پروفایل سبدیار ثبت کرده‌اید را با دکمهٔ زیر بفرستید.',
        reply_markup: {
          keyboard: [[{ text: 'ارسال شماره موبایل', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    }
  }

  private async sendPersonalized(
    token: string,
    chatId: string,
    userId: string,
    newsText: string,
    newsVoice: Buffer | null,
  ) {
    const briefing = await this.portfolios.telegramPortfolioBriefing(userId);
    if (briefing.hasPortfolio && briefing.items.length) {
      const caption = this.formatChartCaption(briefing);
      try {
        const png = renderPortfolioPiePng(briefing.items.map((i) => ({ pct: i.weightPct })));
        await this.sendPhoto(token, chatId, png, caption);
      } catch (e) {
        this.logger.warn(`ارسال نمودار ناموفق، متن جایگزین: ${(e as Error).message.slice(0, 120)}`);
        await this.tg(token, 'sendMessage', {
          chat_id: chatId,
          text: caption,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }
      const advice = this.formatAdvice(briefing);
      if (advice) {
        await this.tg(token, 'sendMessage', {
          chat_id: chatId,
          text: advice,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      }
    } else if (briefing.hasPortfolio) {
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>سبد «${escapeHtml(briefing.name)}»</b>\n${this.digestDateLabel()}\nنمادی در این سبد ثبت نشده بود.`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } else {
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>سبد سهام</b>\n${this.digestDateLabel()}\nسبدی در سایت ثبت نشده بود.`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }

    if (newsText) {
      await this.tg(token, 'sendMessage', {
        chat_id: chatId,
        text: newsText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
    if (newsVoice?.length) {
      try {
        await this.sendAudio(token, chatId, newsVoice, {
          filename: 'akhbar-sabadyar.mp3',
          caption: `اخبار و فرصت‌های سرمایه‌گذاری — ${tehranDateWithWeekdayFa()}`,
          title: 'اخبار و فرصت‌های سرمایه‌گذاری',
          performer: 'سبدیار',
        });
      } catch (e) {
        this.logger.warn(`ارسال صوت اخبار ناموفق: ${(e as Error).message.slice(0, 160)}`);
      }
    }
  }

  private formatChartCaption(briefing: Extract<
    Awaited<ReturnType<PortfoliosService['telegramPortfolioBriefing']>>,
    { hasPortfolio: true }
  >): string {
    const name = escapeHtml(briefing.name);
    const strategy = STRATEGY_FA[briefing.strategy] ?? briefing.strategy;
    const lines: string[] = [
      `<b>نمودار سبد «${name}»</b>`,
      this.digestDateLabel(),
      `استراتژی: ${escapeHtml(strategy)}`,
      `ارزش ثبت‌شده: ${faNum(briefing.totalValueRial)} ریال`,
    ];
    const pnl = briefing.items.reduce((s, i) => s + i.pnlRial, 0);
    if (pnl !== 0) {
      lines.push(`سود/زیان تقریبی: ${faNum(pnl)} ریال`);
    }
    lines.push('');
    if (briefing.fx?.usdIrr) {
      lines.push(`دلار: ${faNum(briefing.fx.usdIrr)} ریال`);
    }
    if (briefing.fx?.goldGramRial) {
      lines.push(`طلا (گرم): ${faNum(briefing.fx.goldGramRial)} ریال`);
    }
    if (briefing.fx?.usdIrr || briefing.fx?.goldGramRial) lines.push('');

    briefing.items.slice(0, 12).forEach((item, idx) => {
      const bar = pctBar(item.weightPct);
      const n = faNum(item.weightPct, 1);
      lines.push(`${toFaDigit(idx + 1)}) ${escapeHtml(item.symbol)}  ${bar}  ${n}٪`);
    });
    if (briefing.otherNames.length) {
      lines.push('', `سبدهای دیگر: ${escapeHtml(briefing.otherNames.join('، '))}`);
    }
    let text = lines.join('\n').trim();
    if (text.length > 1000) text = `${text.slice(0, 990)}…`;
    return text;
  }

  private formatAdvice(briefing: Extract<
    Awaited<ReturnType<PortfoliosService['telegramPortfolioBriefing']>>,
    { hasPortfolio: true }
  >): string | null {
    const a = briefing.analysis;
    if (!a) return null;
    const lines: string[] = [
      '<b>پیشنهاد بهبود سبد</b>',
      this.digestDateLabel(),
      'بر اساس ترکیب فعلی همین سبد',
      `امتیاز سبد: ${toFaDigit(a.score)} از ۱۰۰`,
      '',
    ];
    if (a.summaryFa?.trim()) {
      lines.push(escapeHtml(replaceSocialNetworkBrandFa(a.summaryFa.trim())), '');
    }
    const suggestions = (a.suggestions ?? []).slice(0, 5);
    if (suggestions.length) {
      lines.push('<b>اقدام‌های پیشنهادی</b>');
      suggestions.forEach((s, idx) => {
        lines.push(`${toFaDigit(idx + 1)}) <b>${escapeHtml(replaceSocialNetworkBrandFa(s.titleFa))}</b>`);
        if (s.bodyFa) lines.push(escapeHtml(replaceSocialNetworkBrandFa(s.bodyFa)));
        lines.push('');
      });
    }
    lines.push('این پیام مشاورهٔ سرمایه‌گذاری قطعی نیست.');
    let text = lines.join('\n').trim();
    if (text.length > 3900) text = `${text.slice(0, 3890)}…`;
    return text;
  }

  private digestDateLabel(): string {
    return escapeHtml(tehranDateWithWeekdayFa());
  }

  private formatNewsSection(botNameFa: string | null, batch: NewsBatchRow | null | undefined): string {
    const brand = escapeHtml((botNameFa ?? '').trim() || 'سبدیار');
    const lines: string[] = [`<b>${brand}</b>`, this.digestDateLabel(), ''];

    const items = batch?.items ?? [];
    const opportunities = items.filter((i) => i.category === 'opportunity' || i.isRetailActionable);
    const macros = items.filter((i) => !opportunities.includes(i));

    if (macros.length || batch?.summaryFa?.trim()) {
      lines.push('<b>بازار این‌گونه شد</b>');
      if (batch?.summaryFa?.trim()) {
        lines.push(escapeHtml(replaceSocialNetworkBrandFa(batch.summaryFa.trim())), '');
      }
      for (const [idx, item] of macros.slice(0, 7).entries()) {
        lines.push(`${toFaDigit(idx + 1)}) <b>${escapeHtml(replaceSocialNetworkBrandFa(item.titleFa))}</b>`);
        const body = item.marketImpactFa || item.summaryFa;
        if (body) lines.push(escapeHtml(replaceSocialNetworkBrandFa(body)));
        lines.push('');
      }
    } else {
      lines.push('خبر اثرگذاری بر اقتصاد ایران دیده نشد.', '');
    }

    if (opportunities.length) {
      lines.push('<b>فرصت‌های سرمایه‌گذاری که دیده شد</b>');
      for (const [idx, item] of opportunities.slice(0, 3).entries()) {
        lines.push(`${toFaDigit(idx + 1)}) <b>${escapeHtml(replaceSocialNetworkBrandFa(item.titleFa))}</b>`);
        if (item.deadlineFa) lines.push(`مهلت: ${escapeHtml(item.deadlineFa)}`);
        if (item.participateHowFa) {
          lines.push(`چطور: ${escapeHtml(replaceSocialNetworkBrandFa(item.participateHowFa))}`);
        }
        if (item.officialSourceFa) lines.push(`منبع رسمی: ${escapeHtml(item.officialSourceFa)}`);
        lines.push('');
      }
    } else {
      lines.push('فرصت سرمایه‌گذاری دیده نشد.', '');
    }

    lines.push('این پیام مشاورهٔ سرمایه‌گذاری قطعی نیست.');
    let text = lines.join('\n').trim();
    if (text.length > 3900) text = `${text.slice(0, 3890)}…`;
    return text;
  }

  private scheduleFrom(row: {
    sendHour?: number | null;
    sendMinute?: number | null;
    sendWeekdays?: number[] | null;
  } | null) {
    const weekdays = (row?.sendWeekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    return {
      sendHour: row?.sendHour ?? 8,
      sendMinute: row?.sendMinute ?? 30,
      sendWeekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6],
    };
  }

  private resolveSchedule(
    data: { sendHour?: number; sendMinute?: number; sendWeekdays?: number[] },
    current: { sendHour?: number | null; sendMinute?: number | null; sendWeekdays?: number[] | null } | null,
  ) {
    const base = this.scheduleFrom(current);
    const hour = data.sendHour ?? base.sendHour;
    const minute = data.sendMinute ?? base.sendMinute;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new BadRequestException('ساعت ارسال نامعتبر است');
    }
    const rawDays = data.sendWeekdays ?? base.sendWeekdays;
    const weekdays = [...new Set(rawDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
      (a, b) => a - b,
    );
    if (!weekdays.length) {
      throw new BadRequestException('حداقل یک روز هفته را برای ارسال انتخاب کنید');
    }
    return { hour, minute, weekdays };
  }

  /** exact: همان دقیقه یا ۱۵ دقیقه بعد؛ passed: از ساعت تنظیم‌شده به بعد در همان روز */
  private isSendSlot(
    now: { hour: number; minute: number },
    weekday: number,
    schedule: { sendHour: number; sendMinute: number; sendWeekdays: number[] },
    mode: 'exact' | 'passed' = 'exact',
  ): boolean {
    if (!schedule.sendWeekdays.includes(weekday)) return false;
    const nowMin = now.hour * 60 + now.minute;
    const at = schedule.sendHour * 60 + schedule.sendMinute;
    if (mode === 'passed') return nowMin >= at;
    const retry = at + 15 < 24 * 60 ? at + 15 : null;
    return nowMin === at || nowMin === retry;
  }

  private resolveDigestTtsModel(raw?: string | null): string {
    const model = (raw ?? '').trim();
    if (!model) return DEFAULT_DIGEST_TTS_MODEL;
    if (model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
      throw new BadRequestException('نام مدل متن به صدا نامعتبر است');
    }
    return model;
  }

  private async digestTtsModel(): Promise<string> {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    return this.resolveDigestTtsModel(row?.ttsModel);
  }

  private femaleTtsVoice(): string {
    const configured = (this.config.get<string>('TTS_VOICE') ?? '').trim().toLowerCase();
    return FEMALE_TTS_VOICES.has(configured) ? configured : 'nova';
  }

  /**
   * متن اخبار و فایل صوتی برای همه یکسان است.
   * هر dateKey فقط یک‌بار از مدل ساخته می‌شود و ارسال‌های بعدی همان روز از ذخیره خوانده می‌شود.
   */
  private async sharedNewsVoice(
    dateKey: string,
    botNameFa: string | null,
    batch: NewsBatchRow | null | undefined,
  ): Promise<Buffer | null> {
    const cached = await this.prisma.telegramSharedDigest.findUnique({ where: { dateKey } });
    if (cached?.voiceAudio?.length) {
      return Buffer.from(cached.voiceAudio);
    }

    let script = cached?.voiceScript?.trim() ?? '';
    let persisted = Boolean(script);
    if (!script) {
      const built = await this.buildSharedVoiceScript(botNameFa, batch);
      script = built.script;
      if (!script) return null;
      if (built.fromModel) {
        await this.prisma.telegramSharedDigest.upsert({
          where: { dateKey },
          create: { dateKey, voiceScript: script },
          update: { voiceScript: script },
        });
        persisted = true;
      }
    }

    const adminId = await this.users.getAdminUserId();
    try {
      const audio = await this.llm.speakTts(script, adminId ?? undefined, {
        model: await this.digestTtsModel(),
        voice: this.femaleTtsVoice(),
        instructions: DIGEST_TTS_INSTRUCTIONS,
      });
      if (audio?.length) {
        if (persisted) {
          await this.prisma.telegramSharedDigest.update({
            where: { dateKey },
            data: { voiceAudio: new Uint8Array(audio) },
          });
        }
        return audio;
      }
    } catch (e) {
      this.logger.warn(`ساخت صوت اخبار ناموفق: ${(e as Error).message.slice(0, 160)}`);
    }
    return null;
  }

  private async buildSharedVoiceScript(
    botNameFa: string | null,
    batch: NewsBatchRow | null | undefined,
  ): Promise<{ script: string; fromModel: boolean }> {
    const items = batch?.items ?? [];
    const opportunities = items.filter((i) => i.category === 'opportunity' || i.isRetailActionable);
    const macros = items.filter((i) => !opportunities.includes(i));
    const dateLabel = tehranDateWithWeekdayFa();
    let script = fallbackDigestVoiceScript({
      dateLabel,
      summaryFa: batch?.summaryFa,
      macros,
      opportunities,
    });

    const adminId = await this.users.getAdminUserId();
    try {
      const system = `${await this.llm.getSystemPrompt(adminId ?? undefined, 'telegram_digest_voice')}

افعال این متن خبری فقط گذشته باشند. پیشنهاد بهبود سبد در این متن نیست.`;
      const spoken = await this.llm.chatText(
        'telegram_digest_voice',
        system,
        JSON.stringify(
          {
            dateLabelFa: dateLabel,
            brandFa: (botNameFa ?? '').trim() || 'سبدیار',
            summaryFa: batch?.summaryFa ?? null,
            news: macros.slice(0, 7).map((i) => ({
              titleFa: i.titleFa,
              summaryFa: i.summaryFa,
              marketImpactFa: i.marketImpactFa,
            })),
            opportunities: opportunities.slice(0, 3).map((i) => ({
              titleFa: i.titleFa,
              summaryFa: i.summaryFa,
              participateHowFa: i.participateHowFa,
              deadlineFa: i.deadlineFa,
            })),
          },
          null,
          2,
        ),
        adminId ?? undefined,
      );
      const cleaned = replaceSocialNetworkBrandFa((spoken || '').replace(/\s+/g, ' ').trim());
      if (cleaned) {
        return { script: trimSpokenScript(cleaned), fromModel: true };
      }
    } catch (e) {
      this.logger.warn(
        `متن گفتار اخبار ناموفق؛ متن آماده استفاده شد: ${(e as Error).message.slice(0, 160)}`,
      );
    }
    return { script, fromModel: false };
  }

  private async sendAudio(
    token: string,
    chatId: string,
    buf: Buffer,
    meta: { filename: string; caption: string; title?: string; performer?: string },
  ) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', meta.caption.slice(0, 1000));
    if (meta.title) form.append('title', meta.title);
    if (meta.performer) form.append('performer', meta.performer);
    form.append('audio', new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }), meta.filename);
    const res = await fetch(`${TG_API}/bot${token}/sendAudio`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description || `خطای ارسال صوت ${res.status}`);
    }
  }

  private async sendPhoto(token: string, chatId: string, png: Buffer, caption: string) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'portfolio.png');
    if (caption) {
      form.append('caption', caption.slice(0, 1024));
      form.append('parse_mode', 'HTML');
    }
    const res = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(40_000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description || `خطای ارسال تصویر ${res.status}`);
    }
  }

  private async findProfileByMobile(phone: string) {
    const normalized = normalizeIranMobile(phone);
    if (!normalized) return null;
    return this.prisma.userProfile.findFirst({ where: { mobilePhone: normalized } });
  }

  private async readToken(): Promise<string | null> {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!row?.botTokenEncrypted) return null;
    try {
      return decryptSecret(this.encKey(), row.botTokenEncrypted);
    } catch {
      this.logger.error('رمزگشایی توکن تلگرام ناموفق بود');
      return null;
    }
  }

  private async upsertLog(
    dateKey: string,
    sentCount: number,
    failedCount: number,
    skippedReasonFa: string | null,
  ) {
    return this.prisma.telegramDigestLog.upsert({
      where: { dateKey },
      create: { dateKey, sentCount, failedCount, skippedReasonFa },
      update: { sentCount, failedCount, skippedReasonFa },
    });
  }

  private async tg<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description || `خطای تلگرام ${res.status}`);
    }
    return json.result as T;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function faNum(n: number, digits = 0): string {
  return n.toLocaleString('fa-IR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function toFaDigit(n: number): string {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function pctBar(pct: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
