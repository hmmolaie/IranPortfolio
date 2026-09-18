import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { UsersService } from '../users/users.service';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { extractHttpUrls, explicitLanguage, fetchWebPage, wantsSummary } from './page-fetch';
import {
  downloadYoutubeAudio,
  extractYoutubeId,
  youtubeAudioFilename,
  youtubeTranscript,
} from './youtube';
import { extractPdfContent } from './pdf-extract';
import { buildRtlPdf } from './pdf-rtl-build';

type TgUser = { id: number };
type TgChat = { id: number; username?: string };
type TgDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  document?: TgDocument;
};
type TgUpdate = { update_id: number; message?: TgMessage };

const CONFIG_ID = 'default';
const TG_API = 'https://api.telegram.org';
const TG_LIMIT = 3900;

@Injectable()
export class TelegramAssistantService {
  private readonly logger = new Logger(TelegramAssistantService.name);
  private pollInFlight = false;
  private skippedBacklog = false;
  private busyChats = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
  ) {}

  private encKey() {
    return this.config.get<string>('LLM_TOKEN_ENCRYPTION_KEY') ?? '0123456789abcdef0123456789abcdef';
  }

  async getPublicConfig() {
    const row = await this.prisma.telegramAssistantConfig.findUnique({ where: { id: CONFIG_ID } });
    const username = (row?.botUsername ?? '').trim().replace(/^@/, '');
    return {
      botNameFa: (row?.botNameFa ?? '').trim() || 'دستیار سبدیار',
      botUsername: username,
      deepLink: username ? `https://t.me/${username}` : null,
      enabled: row?.enabled ?? true,
      hasToken: Boolean(row?.botTokenEncrypted),
    };
  }

  async saveConfig(data: {
    botNameFa?: string;
    botUsername?: string;
    botToken?: string;
    enabled?: boolean;
  }) {
    const current = await this.prisma.telegramAssistantConfig.findUnique({ where: { id: CONFIG_ID } });
    let botUsername = (data.botUsername ?? current?.botUsername ?? '').trim().replace(/^@/, '');
    botUsername = botUsername.replace(/^https?:\/\/t\.me\//i, '').replace(/\/+$/, '');
    if (botUsername && !/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) {
      throw new BadRequestException('نام کاربری ربات نامعتبر است (بدون @، فقط حروف و عدد و _)');
    }
    const botNameFa = (data.botNameFa ?? current?.botNameFa ?? 'دستیار سبدیار').trim() || 'دستیار سبدیار';
    let botTokenEncrypted = current?.botTokenEncrypted ?? null;
    if (data.botToken?.trim()) {
      const token = data.botToken.trim();
      if (token.length < 30 || !token.includes(':')) {
        throw new BadRequestException('توکن ربات نامعتبر است (از BotFather کپی کنید)');
      }
      botTokenEncrypted = encryptSecret(this.encKey(), token);
    }
    const enabled = data.enabled ?? current?.enabled ?? true;
    await this.prisma.telegramAssistantConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, botNameFa, botUsername, botTokenEncrypted, enabled },
      update: {
        botNameFa,
        botUsername,
        botTokenEncrypted,
        enabled,
        ...(data.botToken?.trim() ? { lastUpdateId: null } : {}),
      },
    });
    this.skippedBacklog = false;
    return this.getPublicConfig();
  }

  async testConnection() {
    const token = await this.readToken();
    if (!token) throw new BadRequestException('ابتدا توکن دستیار تلگرام را ذخیره کنید');
    const me = await this.tg<{ username?: string; first_name?: string }>(token, 'getMe');
    return {
      ok: true,
      messageFa: 'اتصال دستیار تلگرام برقرار است.',
      botUsername: me.username ?? '',
      botName: me.first_name ?? '',
    };
  }

  @Interval(3500)
  async pollUpdates() {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const token = await this.readToken();
      const cfg = await this.prisma.telegramAssistantConfig.findUnique({ where: { id: CONFIG_ID } });
      if (!token || cfg?.enabled === false) return;

      const offset = cfg?.lastUpdateId ? Number(cfg.lastUpdateId) + 1 : undefined;
      const updates = await this.tg<TgUpdate[]>(token, 'getUpdates', {
        offset,
        timeout: 0,
        allowed_updates: ['message'],
      });
      if (!Array.isArray(updates) || updates.length === 0) return;

      const maxId = Math.max(...updates.map((u) => u.update_id));
      if (!cfg?.lastUpdateId && !this.skippedBacklog) {
        this.skippedBacklog = true;
        await this.prisma.telegramAssistantConfig.update({
          where: { id: CONFIG_ID },
          data: { lastUpdateId: String(maxId) },
        });
        return;
      }

      for (const u of updates) {
        void this.handleUpdate(token, u).catch((e) =>
          this.logger.warn(`دستیار: ${(e as Error).message.slice(0, 180)}`),
        );
      }
      await this.prisma.telegramAssistantConfig.update({
        where: { id: CONFIG_ID },
        data: { lastUpdateId: String(maxId) },
      });
    } catch (e) {
      this.logger.warn(`poll دستیار تلگرام: ${(e as Error).message.slice(0, 180)}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async handleUpdate(token: string, update: TgUpdate) {
    const msg = update.message;
    if (!msg?.chat?.id) return;
    const chatId = String(msg.chat.id);
    const text = `${msg.text ?? ''} ${msg.caption ?? ''}`.trim();

    if (text === '/start' || text === '/help') {
      await this.sendText(
        token,
        chatId,
        'سلام، دستیار دوطرفهٔ سبدیار هستم.\n\n' +
          '• سؤال بپرسید تا به فارسی جواب بدهم (مگر زبان دیگری بخواهید)\n' +
          '• لینک صفحه بفرستید تا ترجمه شود؛ اگر «خلاصه کن» بگویید خلاصه می‌شود\n' +
          '• فایل PDF بفرستید تا PDF فارسی راست‌چین برگردد\n' +
          '• لینک یوتیوب بفرستید تا ترجمه/خلاصه به‌صورت فایل صوتی فارسی بیاید\n\n' +
          'کارهای طولانی با پیام «لطفاً صبر کنید» همراه است.',
      );
      return;
    }

    if (this.busyChats.has(chatId)) {
      await this.sendText(token, chatId, 'درخواست قبلی هنوز تمام نشده. لطفاً کمی صبر کنید.');
      return;
    }
    this.busyChats.add(chatId);
    try {
      if (msg.document && this.isPdf(msg.document)) {
        await this.handlePdf(token, chatId, msg.document, text);
        return;
      }
      const yt = extractYoutubeId(text);
      if (yt) {
        await this.handleYoutube(token, chatId, yt, text);
        return;
      }
      const urls = extractHttpUrls(text).filter((u) => !extractYoutubeId(u));
      if (urls[0]) {
        await this.handlePage(token, chatId, urls[0], text);
        return;
      }
      if (!text) {
        await this.sendText(token, chatId, 'متن، لینک، PDF یا لینک یوتیوب بفرستید.');
        return;
      }
      await this.handleQuestion(token, chatId, text);
    } catch (e) {
      await this.sendText(
        token,
        chatId,
        `انجام این درخواست ممکن نشد.\n${(e as Error).message.slice(0, 280)}`,
      );
    } finally {
      this.busyChats.delete(chatId);
    }
  }

  private isPdf(doc: TgDocument) {
    const mime = (doc.mime_type ?? '').toLowerCase();
    const name = (doc.file_name ?? '').toLowerCase();
    return mime.includes('pdf') || name.endsWith('.pdf');
  }

  private async handleQuestion(token: string, chatId: string, text: string) {
    await this.progress(token, chatId, 'typing', 'سؤال دریافت شد؛ لطفاً صبر کنید، در حال پاسخ با مدل زبانی…');
    const adminId = (await this.users.getAdminUserId()) ?? undefined;
    const lang = explicitLanguage(text);
    const system = await this.llm.getSystemPrompt(adminId, 'telegram_assistant_qa');
    const reply = await this.llm.chatText(
      'telegram_assistant_qa',
      system,
      JSON.stringify({
        languageHint: lang ?? 'فارسی',
        question: text,
        instruction: lang
          ? `به زبان ${lang} پاسخ بده`
          : 'حتماً به فارسی روان و مناسب نمایش راست‌چین پاسخ بده',
      }),
      adminId,
    );
    await this.sendText(token, chatId, reply || 'پاسخی دریافت نشد.');
  }

  private async handlePage(token: string, chatId: string, url: string, userText: string) {
    const summarize = wantsSummary(userText);
    await this.progress(
      token,
      chatId,
      'typing',
      summarize
        ? 'لینک دریافت شد؛ لطفاً صبر کنید، صفحه خوانده و خلاصه می‌شود…'
        : 'لینک دریافت شد؛ لطفاً صبر کنید، صفحه خوانده و به فارسی ترجمه می‌شود…',
    );
    const page = await fetchWebPage(url);
    await this.progress(token, chatId, 'typing', 'صفحه خوانده شد؛ در حال کار مدل زبانی…');
    const adminId = (await this.users.getAdminUserId()) ?? undefined;
    const system = await this.llm.getSystemPrompt(adminId, 'telegram_assistant_page');
    const reply = await this.llm.chatText(
      'telegram_assistant_page',
      system,
      JSON.stringify({
        mode: summarize ? 'summarize' : 'translate',
        url: page.url,
        title: page.title,
        body: page.text.slice(0, 28_000),
      }),
      adminId,
    );
    await this.sendText(token, chatId, reply || 'ترجمه خالی برگشت.');
  }

  private async handlePdf(token: string, chatId: string, doc: TgDocument, caption: string) {
    if ((doc.file_size ?? 0) > 18_000_000) {
      await this.sendText(token, chatId, 'حجم PDF بیشتر از حد مجاز ربات است.');
      return;
    }
    await this.progress(token, chatId, 'upload_document', 'PDF دریافت شد؛ لطفاً صبر کنید، متن و تصویر استخراج می‌شود…');
    const fileBuf = await this.downloadTelegramFile(token, doc.file_id);
    const extracted = await extractPdfContent(fileBuf);
    if (!extracted.text && !extracted.images.length) {
      await this.sendText(token, chatId, 'از این PDF متن یا تصویری استخراج نشد.');
      return;
    }
    await this.progress(token, chatId, 'typing', 'استخراج شد؛ در حال ترجمه به فارسی…');
    const adminId = (await this.users.getAdminUserId()) ?? undefined;
    const system = await this.llm.getSystemPrompt(adminId, 'telegram_assistant_pdf');
    const md = await this.llm.chatText(
      'telegram_assistant_pdf',
      system,
      JSON.stringify({
        mode: wantsSummary(caption) ? 'summarize' : 'translate',
        pageCount: extracted.pageCount,
        imageCount: extracted.images.length,
        text: extracted.text.slice(0, 36_000),
        imagePlaceholders: extracted.images.map((_, i) => `image-${i + 1}`),
      }),
      adminId,
    );
    await this.progress(token, chatId, 'upload_document', 'در حال ساخت PDF راست‌چین با فونت فارسی…');
    const pdf = await buildRtlPdf({
      titleFa: 'ترجمهٔ سند',
      markdownFa: md || extracted.text.slice(0, 8_000),
      images: extracted.images,
    });
    await this.sendDocument(token, chatId, pdf, 'tarjome-farsi.pdf', 'PDF فارسی آماده است.');
  }

  private async handleYoutube(token: string, chatId: string, videoId: string, userText: string) {
    const summarize = wantsSummary(userText);
    await this.progress(
      token,
      chatId,
      'record_voice',
      'لینک یوتیوب دریافت شد؛ لطفاً صبر کنید، در حال خواندن زیرنویس…',
    );
    const adminId = (await this.users.getAdminUserId()) ?? undefined;
    let sourceText: string | null = null;
    try {
      sourceText = await youtubeTranscript(videoId);
    } catch (e) {
      this.logger.warn(`زیرنویس یوتیوب ${videoId}: ${(e as Error).message.slice(0, 180)}`);
    }
    if (!sourceText) {
      await this.progress(token, chatId, 'record_voice', 'زیرنویس پیدا نشد؛ در حال گرفتن صدا و رونویسی…');
      const audio = await downloadYoutubeAudio(videoId);
      if (!audio) {
        await this.sendText(
          token,
          chatId,
          'متن این ویدیو استخراج نشد. یوتیوب زیرنویس عمومی نداشت و دریافت صدا هم ممکن نشد. ویدیوی دیگری با زیرنویس امتحان کنید.',
        );
        return;
      }
      const filename = youtubeAudioFilename(audio, videoId);
      this.logger.log(`رونویسی یوتیوب ${videoId} حجم=${audio.length} فایل=${filename}`);
      sourceText = await this.llm.transcribeAudio(audio, filename, adminId);
    }
    if (!sourceText?.trim()) {
      await this.sendText(token, chatId, 'متن ویدیو خالی بود.');
      return;
    }
    this.logger.log(`متن یوتیوب ${videoId}: ${sourceText.length} نویسه`);
    await this.progress(
      token,
      chatId,
      'typing',
      summarize ? 'در حال خلاصهٔ فارسی…' : 'در حال ترجمه به فارسی روان…',
    );
    const system = await this.llm.getSystemPrompt(adminId, 'telegram_assistant_youtube');
    const fa = await this.llm.chatText(
      'telegram_assistant_youtube',
      system,
      JSON.stringify({
        mode: summarize ? 'summarize' : 'translate',
        videoId,
        transcript: sourceText.slice(0, 36_000),
      }),
      adminId,
    );
    const spoken = (fa || '').trim();
    if (spoken) {
      await this.sendText(token, chatId, spoken);
    }
    const parts = splitForTts(spoken || sourceText);
    if (!parts.length) {
      await this.sendText(token, chatId, 'متن فارسی برای ساخت صدا خالی بود.');
      return;
    }
    await this.progress(token, chatId, 'record_voice', 'در حال ساخت فایل صوتی فارسی…');
    try {
      for (let i = 0; i < parts.length; i++) {
        const mp3 = await this.llm.speakTts(parts[i], adminId);
        await this.sendAudio(
          token,
          chatId,
          mp3,
          parts.length > 1 ? `tarjome-farsi-${i + 1}.mp3` : 'tarjome-farsi.mp3',
          i === 0 ? 'فایل صوتی فارسی آماده است.' : `بخش ${i + 1}`,
        );
      }
    } catch (e) {
      this.logger.warn(`TTS یوتیوب ${videoId}: ${(e as Error).message.slice(0, 180)}`);
      await this.sendText(
        token,
        chatId,
        `متن آماده شد ولی ساخت صدا ناموفق بود.\n${(e as Error).message.slice(0, 220)}`,
      );
    }
  }

  private async progress(token: string, chatId: string, action: string, text: string) {
    try {
      await this.tg(token, 'sendChatAction', { chat_id: chatId, action });
    } catch {
      /* ignore */
    }
    await this.sendText(token, chatId, text);
  }

  private async sendText(token: string, chatId: string, text: string) {
    const chunks = splitTelegram(text);
    for (const chunk of chunks) {
      await this.tg(token, 'sendMessage', { chat_id: chatId, text: chunk });
    }
  }

  private async sendDocument(token: string, chatId: string, buf: Buffer, filename: string, caption: string) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1000));
    form.append('document', new Blob([new Uint8Array(buf)], { type: 'application/pdf' }), filename);
    await this.tgForm(token, 'sendDocument', form);
  }

  private async sendAudio(token: string, chatId: string, buf: Buffer, filename: string, caption: string) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1000));
    form.append('audio', new Blob([new Uint8Array(buf)], { type: 'audio/mpeg' }), filename);
    await this.tgForm(token, 'sendAudio', form);
  }

  private async downloadTelegramFile(token: string, fileId: string): Promise<Buffer> {
    const meta = await this.tg<{ file_path?: string }>(token, 'getFile', { file_id: fileId });
    if (!meta.file_path) throw new Error('مسیر فایل تلگرام خالی است');
    const res = await fetch(`${TG_API}/file/bot${token}/${meta.file_path}`, {
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`دانلود فایل تلگرام ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async readToken(): Promise<string | null> {
    const row = await this.prisma.telegramAssistantConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!row?.botTokenEncrypted) return null;
    try {
      return decryptSecret(this.encKey(), row.botTokenEncrypted);
    } catch {
      this.logger.error('رمزگشایی توکن دستیار تلگرام ناموفق بود');
      return null;
    }
  }

  private async tg<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as { ok?: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description || `خطای تلگرام ${res.status}`);
    }
    return json.result as T;
  }

  private async tgForm(token: string, method: string, form: FormData) {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(90_000),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.description || `خطای تلگرام ${res.status}`);
    }
  }
}

function splitForTts(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= 4000) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest.length && parts.length < 6) {
    if (rest.length <= 4000) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', 3900);
    if (cut < 800) cut = 3900;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts;
}

function splitTelegram(text: string): string[] {
  const t = text.trim() || '—';
  if (t.length <= TG_LIMIT) return [t];
  const parts: string[] = [];
  let rest = t;
  while (rest.length) {
    parts.push(rest.slice(0, TG_LIMIT));
    rest = rest.slice(TG_LIMIT);
  }
  return parts.slice(0, 8);
}
