import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';
import { encryptionKey } from '../common/app-secrets';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import {
  daysAgoDateKey,
  tehranDateKey,
  tehranDateWithWeekdayFa,
  tehranTimeParts,
} from '../news/tehran-date';

/**
 * خبرنامهٔ شخصی مدیر. جدا از اطلاع‌رسانی کاربران سبدیار:
 * ربات خودش، چت خودش، و هیچ داده‌ای از سبد یا کاربران نمی‌خواند.
 */

const TG_API = 'https://api.telegram.org';
const PURPOSE = 'personal_digest';
const TELEGRAM_TEXT_LIMIT = 3900;

export const MAX_TOPICS = 8;
export const MAX_ITEMS_PER_TOPIC = 10;

export type DigestTopicInput = { titleFa: string; focusFa: string; itemsCount: number };
type DigestTopic = DigestTopicInput & { key: string };

/** سرفصل‌های پیش‌فرض تا وقتی مدیر در پنل عوض نکرده است */
export const DEFAULT_TOPICS: DigestTopicInput[] = [
  {
    titleFa: '🧭 مدیریت محصول',
    focusFa:
      'استراتژی محصول، discovery، اولویت‌بندی، متریک‌ها و آزمایش، growth، pricing، محصولات هوش مصنوعی، درس‌های عملی مدیران محصول و بنیان‌گذاران شناخته‌شده',
    itemsCount: 5,
  },
  {
    titleFa: '🛡 امنیت سایبری',
    focusFa:
      'آسیب‌پذیری‌ها و CVEهای مهم، zero-day، حملات و نفوذهای تازه، تحلیل بدافزار، باج‌افزار، امنیت ابری و زنجیرهٔ تأمین، هشدارهای CISA و پژوهشگران معتبر',
    itemsCount: 5,
  },
  {
    titleFa: '🌍 اقتصاد کلان جهان و آمریکا',
    focusFa:
      'فدرال رزرو و بانک‌های مرکزی، تورم، بازار کار، اوراق خزانه، دلار، نفت، رشد اقتصادی، تحلیل اقتصاددانان و تحلیل‌گران بازار سرشناس',
    itemsCount: 5,
  },
];

function normalizeTopics(raw: unknown): DigestTopicInput[] {
  if (!Array.isArray(raw)) return DEFAULT_TOPICS;
  const out: DigestTopicInput[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const titleFa = typeof rec.titleFa === 'string' ? rec.titleFa.trim().slice(0, 80) : '';
    const focusFa = typeof rec.focusFa === 'string' ? rec.focusFa.trim().slice(0, 600) : '';
    const n = Number(rec.itemsCount);
    if (!titleFa) continue;
    out.push({
      titleFa,
      focusFa,
      itemsCount: Number.isInteger(n) ? Math.min(MAX_ITEMS_PER_TOPIC, Math.max(1, n)) : 5,
    });
    if (out.length >= MAX_TOPICS) break;
  }
  return out.length ? out : DEFAULT_TOPICS;
}

function withKeys(topics: DigestTopicInput[]): DigestTopic[] {
  return topics.map((t, i) => ({ ...t, key: `t${i + 1}` }));
}

/** آیا این ساعت و دقیقه نوبت ارسال است؟ شمارش دوره هر روز از startHour از نو شروع می‌شود. */
function isDigestSlot(
  now: { hour: number; minute: number },
  c: { intervalHours: number; startHour: number; sendMinute: number },
): boolean {
  if (now.minute !== c.sendMinute) return false;
  const interval = Math.min(24, Math.max(1, c.intervalHours));
  const diff = (now.hour - c.startHour + 24) % 24;
  return diff % interval === 0;
}

type DigestItem = {
  topic: string;
  titleFa: string;
  summaryFa: string;
  author?: string;
  url?: string;
};

type DigestLlmOut = {
  items?: Array<{
    topic?: string;
    titleFa?: string;
    summaryFa?: string;
    author?: string;
    url?: string;
  }>;
};

export type SavePersonalDigestInput = {
  botUsername?: string;
  botToken?: string;
  chatId?: string;
  intervalHours?: number;
  startHour?: number;
  sendMinute?: number;
  topics?: DigestTopicInput[];
  enabled?: boolean;
};

@Injectable()
export class PersonalDigestService {
  private readonly logger = new Logger(PersonalDigestService.name);
  private inFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

  private async readConfig() {
    return this.prisma.personalDigestConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  async getPublicConfig() {
    const c = await this.readConfig();
    const runs = await this.prisma.personalDigestRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        slotKey: true,
        manual: true,
        status: true,
        itemCount: true,
        errorFa: true,
        createdAt: true,
      },
    });
    return {
      botUsername: c.botUsername ?? '',
      hasToken: Boolean(c.botTokenEncrypted),
      chatId: c.chatId ?? '',
      intervalHours: c.intervalHours,
      startHour: c.startHour,
      sendMinute: c.sendMinute,
      topics: normalizeTopics(c.topics),
      enabled: c.enabled,
      running: this.inFlight,
      runs,
    };
  }

  async saveConfig(input: SavePersonalDigestInput) {
    const data: Prisma.PersonalDigestConfigUpdateInput = {};
    if (input.botUsername !== undefined) {
      data.botUsername = input.botUsername.trim().replace(/^@/, '') || null;
    }
    if (input.botToken !== undefined && input.botToken.trim()) {
      const token = input.botToken.trim();
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
        throw new BadRequestException('توکن ربات معتبر به نظر نمی‌رسد. توکن را از BotFather کپی کنید.');
      }
      data.botTokenEncrypted = encryptSecret(encryptionKey(), token);
    }
    if (input.chatId !== undefined) {
      const chatId = input.chatId.trim();
      if (chatId && !/^-?\d{3,20}$/.test(chatId)) {
        throw new BadRequestException('شناسهٔ چت باید عدد باشد.');
      }
      data.chatId = chatId || null;
    }
    if (input.intervalHours !== undefined) data.intervalHours = input.intervalHours;
    if (input.startHour !== undefined) data.startHour = input.startHour === 24 ? 0 : input.startHour;
    if (input.sendMinute !== undefined) data.sendMinute = input.sendMinute;
    if (input.topics !== undefined) {
      const topics = input.topics.filter((t) => t.titleFa.trim());
      if (!topics.length) throw new BadRequestException('حداقل یک سرفصل لازم است.');
      data.topics = normalizeTopics(topics) as unknown as Prisma.InputJsonValue;
    }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    await this.readConfig();
    await this.prisma.personalDigestConfig.update({ where: { id: 'default' }, data });
    return this.getPublicConfig();
  }

  /** آخرین کسی که به ربات پیام داده را پیدا می‌کند و شناسهٔ چتش را ذخیره می‌کند. */
  async detectChat() {
    const token = await this.readToken();
    if (!token) return { ok: false, messageFa: 'اول توکن ربات را ذخیره کنید.' };
    let updates: Array<{
      message?: { chat?: { id?: number; type?: string; username?: string; first_name?: string } };
    }>;
    try {
      updates = await this.tg(token, 'getUpdates', { limit: 50, allowed_updates: ['message'] });
    } catch (e) {
      const text = (e as Error).message;
      if (/webhook/i.test(text)) {
        return {
          ok: false,
          messageFa:
            'این ربات هنوز به سرویس قبلی (webhook) وصل است. اگر سرویس قبلی را دیگر لازم ندارید، شناسهٔ چت را دستی وارد کنید یا webhook را از ربات بردارید.',
        };
      }
      return { ok: false, messageFa: `خواندن پیام‌های ربات ناموفق بود: ${text}` };
    }
    const chats = updates
      .map((u) => u.message?.chat)
      .filter((c): c is NonNullable<typeof c> => Boolean(c?.id) && c?.type === 'private');
    const chat = chats[chats.length - 1];
    if (!chat?.id) {
      return {
        ok: false,
        messageFa: 'پیامی پیدا نشد. در تلگرام ربات را باز کنید، دکمهٔ Start را بزنید یا یک پیام بفرستید، بعد دوباره امتحان کنید.',
      };
    }
    const chatId = String(chat.id);
    await this.readConfig();
    await this.prisma.personalDigestConfig.update({ where: { id: 'default' }, data: { chatId } });
    const who = chat.username ? `@${chat.username}` : chat.first_name ?? '';
    return { ok: true, chatId, messageFa: `شناسهٔ چت ${who} پیدا و ذخیره شد.` };
  }

  async sendTestMessage() {
    const { token, chatId } = await this.requireTarget();
    await this.sendHtml(
      token,
      chatId,
      '✅ <b>اتصال خبرنامهٔ شخصی برقرار است.</b>\nاز این به بعد خلاصهٔ فنی‌ترین پست‌ها در همین چت می‌آید.',
    );
    return { ok: true, messageFa: 'پیام آزمایشی به تلگرام شما فرستاده شد.' };
  }

  /** ارسال فوری؛ در پس‌زمینه اجرا می‌شود چون جستجوی زنده ممکن است چند دقیقه طول بکشد. */
  async startSendNow() {
    await this.requireTarget();
    if (!(await this.readConfig()).enabled) {
      return { ok: false, messageFa: 'خبرنامه خاموش است. اول آن را از بالای همین صفحه روشن کنید.' };
    }
    if (this.inFlight) {
      return { ok: false, messageFa: 'یک نوبت خبرنامه همین حالا در حال ساخت است. چند دقیقه بعد دوباره امتحان کنید.' };
    }
    const slotKey = `manual-${new Date().toISOString()}`;
    void this.runOnce(slotKey, true).catch((e) =>
      this.logger.error(`ارسال دستی خبرنامهٔ شخصی ناموفق: ${(e as Error).message}`),
    );
    return {
      ok: true,
      messageFa: 'ساخت خبرنامه شروع شد. معمولاً یکی دو دقیقه بعد در تلگرام می‌رسد و نتیجه در جدول پایین همین صفحه می‌آید.',
    };
  }

  @Cron('* * * * *', { timeZone: 'Asia/Tehran', name: 'personal-digest-tick' })
  async scheduledTick() {
    const c = await this.prisma.personalDigestConfig.findUnique({ where: { id: 'default' } });
    if (!c?.enabled || !c.botTokenEncrypted || !c.chatId) return;
    const now = tehranTimeParts();
    if (!isDigestSlot(now, c)) return;
    const slotKey = `${tehranDateKey()}T${String(now.hour).padStart(2, '0')}`;
    await this.runOnce(slotKey, false);
  }

  private async runOnce(slotKey: string, manual: boolean) {
    if (this.inFlight) {
      this.logger.log(`خبرنامهٔ شخصی در حال اجراست؛ نوبت ${slotKey} رد شد`);
      return;
    }
    this.inFlight = true;
    let runId: string | null = null;
    try {
      try {
        const run = await this.prisma.personalDigestRun.create({ data: { slotKey, manual } });
        runId = run.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          this.logger.log(`خبرنامهٔ شخصی نوبت ${slotKey} قبلاً انجام شده`);
          return;
        }
        throw e;
      }
      const { token, chatId } = await this.requireTarget();
      const config = await this.readConfig();
      if (!config.enabled) {
        await this.prisma.personalDigestRun.update({
          where: { id: runId },
          data: { status: 'cancelled', errorFa: 'خبرنامه خاموش است.' },
        });
        return;
      }
      const topics = withKeys(normalizeTopics(config.topics));
      let items: DigestItem[];
      try {
        items = await this.collect(topics);
      } catch (e) {
        const msg = redact((e as Error).message);
        await this.prisma.personalDigestRun.update({
          where: { id: runId },
          data: { status: 'error', errorFa: msg.slice(0, 4000) },
        });
        if (!(await this.readConfig()).enabled) return;
        await this.sendHtml(
          token,
          chatId,
          `⚠️ خبرنامهٔ این نوبت ساخته نشد.\n<code>${escapeHtml(msg.slice(0, 600))}</code>`,
        ).catch(() => undefined);
        return;
      }
      // اگر وسط ساخت خبرنامه خاموش شد، چیزی فرستاده نشود
      if (!(await this.readConfig()).enabled) {
        await this.prisma.personalDigestRun.update({
          where: { id: runId },
          data: { status: 'cancelled', errorFa: 'خبرنامه پیش از ارسال خاموش شد.' },
        });
        return;
      }
      for (const chunk of this.render(items, topics)) {
        await this.sendHtml(token, chatId, chunk);
      }
      await this.prisma.personalDigestRun.update({
        where: { id: runId },
        data: { status: 'sent', itemCount: items.length, titles: items.map((i) => i.titleFa) },
      });
      this.logger.log(`خبرنامهٔ شخصی ${slotKey}: ${items.length} مورد فرستاده شد`);
    } catch (e) {
      const msg = redact((e as Error).message);
      this.logger.error(`خبرنامهٔ شخصی ${slotKey} ناموفق: ${msg}`);
      if (runId) {
        await this.prisma.personalDigestRun
          .update({ where: { id: runId }, data: { status: 'error', errorFa: msg.slice(0, 4000) } })
          .catch(() => undefined);
      }
    } finally {
      this.inFlight = false;
    }
  }

  private async collect(topics: DigestTopic[]): Promise<DigestItem[]> {
    const ownerId = (await this.users.getAdminUserId()) ?? undefined;
    const recent = await this.prisma.personalDigestRun.findMany({
      where: { status: 'sent' },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { titles: true },
    });
    const alreadySent = recent.flatMap((r) => r.titles).slice(0, 60);
    const basePrompt = await this.llm.getSystemPrompt(ownerId, PURPOSE);
    const system = `${basePrompt}

برای هر سرفصل حداکثر به اندازهٔ maxItems همان سرفصل پست بیاور و topic هر مورد را دقیقاً key همان سرفصل بگذار.`;
    const payload = {
      nowTehran: new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tehran' }),
      topics: topics.map((t) => ({ key: t.key, titleFa: t.titleFa, focusFa: t.focusFa, maxItems: t.itemsCount })),
      alreadySent,
    };
    const out = await this.llm.chatJson<DigestLlmOut>(
      PURPOSE,
      system,
      JSON.stringify(payload, null, 2),
      ownerId,
      {
        once: true,
        errorLogOnly: true,
        preferGrok: true,
        liveSearch: { x: true, web: false, fromDate: daysAgoDateKey(2), toDate: tehranDateKey() },
      },
    );
    return this.cleanItems(out.items ?? [], topics);
  }

  private cleanItems(raw: NonNullable<DigestLlmOut['items']>, topics: DigestTopic[]): DigestItem[] {
    const limits = new Map(topics.map((t) => [t.key, t.itemsCount]));
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    const out: DigestItem[] = [];
    for (const r of raw) {
      const topic = (r.topic ?? '').trim().toLowerCase();
      const titleFa = (r.titleFa ?? '').trim();
      const summaryFa = (r.summaryFa ?? '').trim();
      const limit = limits.get(topic);
      if (limit === undefined || !titleFa || !summaryFa) continue;
      const dedupe = titleFa.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(dedupe)) continue;
      const n = counts.get(topic) ?? 0;
      if (n >= limit) continue;
      seen.add(dedupe);
      counts.set(topic, n + 1);
      const url = (r.url ?? '').trim();
      out.push({
        topic,
        titleFa: titleFa.slice(0, 200),
        summaryFa: summaryFa.slice(0, 900),
        author: (r.author ?? '').trim().slice(0, 60) || undefined,
        url: /^https:\/\/[^\s"<>]+$/i.test(url) ? url : undefined,
      });
    }
    return out;
  }

  private render(items: DigestItem[], topics: DigestTopic[]): string[] {
    const hour = tehranTimeParts();
    const clock = `${String(hour.hour).padStart(2, '0')}:${String(hour.minute).padStart(2, '0')}`;
    const header = `📰 <b>خبرنامهٔ فنی</b>\n${escapeHtml(tehranDateWithWeekdayFa())} — ساعت ${clock}`;
    if (!items.length) {
      return [`${header}\n\nدر این نوبت پست فنی تازه و ارزشمندی پیدا نشد.`];
    }
    const blocks: string[] = [header];
    for (const topic of topics) {
      const list = items.filter((i) => i.topic === topic.key);
      if (!list.length) continue;
      blocks.push(`\n<b>${escapeHtml(topic.titleFa)}</b>`);
      list.forEach((item, idx) => {
        const source = item.url
          ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.author || 'منبع')}</a>`
          : item.author
            ? escapeHtml(item.author)
            : '';
        blocks.push(
          `<b>${(idx + 1).toLocaleString('fa-IR')}. ${escapeHtml(item.titleFa)}</b>\n${escapeHtml(item.summaryFa)}${
            source ? `\n🔗 ${source}` : ''
          }`,
        );
      });
    }
    const chunks: string[] = [];
    let current = '';
    for (const block of blocks) {
      const next = current ? `${current}\n\n${block}` : block;
      if (next.length > TELEGRAM_TEXT_LIMIT && current) {
        chunks.push(current);
        current = block;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private async requireTarget(): Promise<{ token: string; chatId: string }> {
    const token = await this.readToken();
    if (!token) throw new BadRequestException('توکن ربات خبرنامه ذخیره نشده است.');
    const c = await this.readConfig();
    if (!c.chatId) throw new BadRequestException('شناسهٔ چت تلگرام شما ذخیره نشده است.');
    return { token, chatId: c.chatId };
  }

  private async readToken(): Promise<string | null> {
    const c = await this.readConfig();
    if (!c.botTokenEncrypted) return null;
    try {
      return decryptSecret(encryptionKey(), c.botTokenEncrypted);
    } catch {
      this.logger.error('رمزگشایی توکن ربات خبرنامه ناموفق بود؛ توکن را دوباره ذخیره کنید');
      return null;
    }
  }

  private async sendHtml(token: string, chatId: string, text: string) {
    await this.tg(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  private async tg<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new Error(redact(`اتصال به تلگرام برقرار نشد (${method}): ${(e as Error).message}`));
    }
    const raw = await res.text();
    let json: { ok?: boolean; result?: T; description?: string };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      throw new Error(`پاسخ تلگرام JSON نبود (${method}). HTTP ${res.status}`);
    }
    if (!res.ok || !json.ok) {
      throw new Error(redact(json.description || `خطای تلگرام ${res.status} (${method})`));
    }
    return json.result as T;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function redact(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot***').replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, '***');
}
