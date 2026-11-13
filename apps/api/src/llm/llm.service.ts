import { randomUUID } from 'crypto';
import { Agent, fetch as undiciFetch } from 'undici';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptionKey } from '../common/app-secrets';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AiUsageService, TokenUse } from '../ai-usage/ai-usage.service';
import { transcribeBytes } from '../telegram-assistant/youtube-subs/gapgpt';
import {
  audioSpeechUrl,
  isGapGptBase,
  speechModelAcceptsInstructions,
  speechModelForBase,
  splitSpeechInput,
} from './tts-voice';
import { LLM_PROMPT_DEFAULTS, isValidPromptPurpose } from './prompt-defaults';
import {
  NEWS_LLM_PURPOSES,
  SOCIAL_NETWORK_LABEL_FA,
  appendSocialNetworkOutputRule,
  redactSocialNetworkBrandInFaFields,
} from './social-source-wording';

type LlmCreds = {
  baseUrl: string;
  model: string;
  apiKey: string;
  fallbackModels: string[];
  pinPrimary?: boolean;
};

export type SystemOneQuestion = {
  type: 'choice' | 'score' | 'noul';
  instructions: string;
  criteria?: Record<string, string> | string[];
};

type GapGptWallet = {
  ok: boolean;
  gapgpt: boolean;
  unlimited: boolean;
  remainUsd: number | null;
  usedUsd: number | null;
  remainRial: number | null;
  usedRial: number | null;
  usdIrr: number | null;
  nativeRial: boolean;
  messageFa: string;
};

class LlmHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }

  get isRateLimited() {
    return this.status === 429 || /rate.?limit/i.test(this.body) || /rate.?limit/i.test(this.message);
  }

  get isGatewayTimeout() {
    return this.status === 502 || this.status === 503 || this.status === 504 || this.status === 524;
  }

  /** سرویس ابزار جستجو را پیش از اجرای مدل رد کرده؛ هزینه‌ای مصرف نشده و ابزار بعدی قابل امتحان است */
  get isUnsupportedTool() {
    if (this.status !== 400 && this.status !== 404 && this.status !== 422) return false;
    return (
      /tool/i.test(this.body) &&
      /not supported|unsupported|unknown|unrecognized|not available|invalid/i.test(this.body)
    );
  }
}

export function isLlmGatewayFailure(err: unknown): boolean {
  if (err instanceof LlmHttpError) return err.isGatewayTimeout;
  const message = err instanceof Error ? err.message : String(err);
  return /\b50[234]\b|\b524\b|gateway time-?out|<!DOCTYPE html/i.test(message);
}

function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]');
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseModelList(raw: string): string[] {
  return raw
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type LlmLiveSearch = {
  x?: boolean;
  web?: boolean;
  fromDate?: string;
  toDate?: string;
};

export type LlmChatOptions = {
  liveSearch?: boolean | LlmLiveSearch;
  /** اگر در فهرست مدل‌ها Grok باشد، برای جستجوی شبکه اجتماعی همان را جلو می‌اندازد */
  preferGrok?: boolean;
  /** فقط یک درخواست. مدل جایگزین و تلاش دوباره در همان نوبت انجام نمی‌شود. */
  once?: boolean;
  /** خطا فقط در «خطاهای مشاهده‌شده» بماند و ردیف سوابق ساخته نشود. */
  errorLogOnly?: boolean;
  /** سقف زمان هر درخواست مدل (میلی‌ثانیه)؛ پیش‌فرض ۱۲۰ ثانیه. با پایان زمان، دوباره بدون json_object امتحان نمی‌شود. */
  timeoutMs?: number;
};

function normalizeLiveSearch(raw?: LlmChatOptions['liveSearch']): LlmLiveSearch | null {
  if (!raw) return null;
  if (raw === true) return { x: true, web: false };
  return {
    x: raw.x !== false,
    web: Boolean(raw.web),
    fromDate: raw.fromDate,
    toDate: raw.toDate,
  };
}

function uniqueStrings(items: string[]): string[] {
  return items.filter((m, i, arr) => m && arr.indexOf(m) === i);
}

function preferGrokFirst(models: string[]): string[] {
  const grok = models.filter((m) => /grok/i.test(m));
  const rest = models.filter((m) => !/grok/i.test(m));
  return grok.length ? [...grok, ...rest] : models;
}

function systemOneAnswers(json: Record<string, unknown>): Record<string, unknown> | null {
  const direct = json.answers;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const result = json.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const nested = (result as { answers?: unknown }).answers;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return null;
}

function systemOneFailureFa(status: number, detail: string): string {
  const head = status
    ? `فراخوانی System One ناموفق بود (${status.toLocaleString('fa-IR')}).`
    : 'فراخوانی System One ناموفق بود.';
  let extra = '';
  try {
    const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
    const message = parsed.message ?? parsed.error;
    if (typeof message === 'string') extra = message;
    else if (message && typeof message === 'object' && 'message' in message) {
      const inner = (message as { message?: unknown }).message;
      if (typeof inner === 'string') extra = inner;
    }
  } catch {
    extra = detail;
  }
  extra = extra.replace(/\s+/g, ' ').trim().slice(0, 180);
  return extra ? `${head}\n${extra}` : head;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiUsage: AiUsageService,
  ) {}

  encryptToken(token: string): string {
    return encryptSecret(encryptionKey(), token);
  }

  decryptToken(payload: string): string {
    return decryptSecret(encryptionKey(), payload);
  }

  async saveSettings(
    userId: string,
    data: {
      baseUrl?: string;
      model?: string;
      systemModel?: string;
      systemOneBaseUrl?: string;
      systemOneApiToken?: string;
      searchBaseUrl?: string;
      searchModel?: string;
      searchApiToken?: string;
      apiToken?: string;
      usePlatformFallback?: boolean;
    },
  ) {
    const searchBaseUrl = data.searchBaseUrl?.trim().replace(/\/+$/, '');
    if (searchBaseUrl && !/^https?:\/\//i.test(searchBaseUrl)) {
      throw new BadRequestException('نشانی سرویس جستجوی زنده باید با http یا https شروع شود');
    }
    const update: Record<string, unknown> = {};
    if (searchBaseUrl !== undefined) update.searchBaseUrl = searchBaseUrl;
    if (data.searchModel !== undefined) update.searchModel = data.searchModel.trim();
    if (data.searchApiToken?.trim()) {
      update.searchTokenEncrypted = this.encryptToken(data.searchApiToken.trim());
    }
    if (data.baseUrl !== undefined) update.baseUrl = data.baseUrl.trim().replace(/\/$/, '');
    if (data.model !== undefined) update.model = data.model.trim();
    if (data.systemModel !== undefined) update.systemModel = data.systemModel.trim();
    if (data.systemOneBaseUrl !== undefined) {
      update.systemOneBaseUrl = data.systemOneBaseUrl.trim().replace(/\/$/, '') || 'https://system-one.dev/v1';
    }
    if (data.usePlatformFallback !== undefined) update.usePlatformFallback = data.usePlatformFallback;
    if (data.apiToken) update.apiTokenEncrypted = this.encryptToken(data.apiToken.trim());
    if (data.systemOneApiToken) update.systemOneTokenEncrypted = this.encryptToken(data.systemOneApiToken.trim());

    return this.prisma.llmSetting.upsert({
      where: { userId },
      create: {
        userId,
        baseUrl: (data.baseUrl ?? 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
        model: (data.model ?? 'gpt-4o-mini').trim(),
        systemModel: data.systemModel?.trim() ?? '',
        systemOneBaseUrl:
          data.systemOneBaseUrl?.trim().replace(/\/$/, '') || 'https://system-one.dev/v1',
        apiTokenEncrypted: data.apiToken ? this.encryptToken(data.apiToken.trim()) : undefined,
        systemOneTokenEncrypted: data.systemOneApiToken
          ? this.encryptToken(data.systemOneApiToken.trim())
          : undefined,
        searchBaseUrl: searchBaseUrl ?? '',
        searchModel: data.searchModel?.trim() ?? '',
        searchTokenEncrypted: data.searchApiToken?.trim()
          ? this.encryptToken(data.searchApiToken.trim())
          : undefined,
        usePlatformFallback: data.usePlatformFallback ?? true,
      },
      update,
    });
  }

  async getPublicSettings(userId: string) {
    const s = await this.prisma.llmSetting.findUnique({ where: { userId } });
    if (!s) return null;
    return {
      baseUrl: s.baseUrl,
      model: s.model,
      systemModel: s.systemModel,
      systemOneBaseUrl: s.systemOneBaseUrl,
      usePlatformFallback: s.usePlatformFallback,
      hasToken: Boolean(s.apiTokenEncrypted),
      hasSystemOneToken: Boolean(s.systemOneTokenEncrypted),
      searchBaseUrl: s.searchBaseUrl,
      searchModel: s.searchModel,
      hasSearchToken: Boolean(s.searchTokenEncrypted),
    };
  }

  async listPrompts(userId: string) {
    const customs = await this.prisma.llmPromptTemplate.findMany({ where: { userId } });
    const customMap = new Map(customs.map((c) => [c.purpose, c.systemPrompt]));

    return Object.entries(LLM_PROMPT_DEFAULTS).map(([purpose, def]) => {
      const isCustom = customMap.has(purpose);
      return {
        purpose,
        labelFa: def.labelFa,
        descriptionFa: def.descriptionFa,
        systemPrompt: isCustom ? customMap.get(purpose)! : def.systemPrompt,
        defaultSystemPrompt: def.systemPrompt,
        isCustom,
      };
    });
  }

  async getSystemPrompt(userId: string | undefined, purpose: string): Promise<string> {
    const fallback = LLM_PROMPT_DEFAULTS[purpose]?.systemPrompt ?? '';
    const promptUserId = (await this.adminUserId()) ?? userId;
    if (!promptUserId) return fallback;

    const custom = await this.prisma.llmPromptTemplate.findUnique({
      where: { userId_purpose: { userId: promptUserId, purpose } },
    });
    const prompt = custom?.systemPrompt ?? fallback;
    return NEWS_LLM_PURPOSES.has(purpose) ? appendSocialNetworkOutputRule(prompt) : prompt;
  }

  async savePrompt(userId: string, purpose: string, systemPrompt: string) {
    if (!isValidPromptPurpose(purpose)) {
      throw new BadRequestException('شناسه پرامپت نامعتبر است');
    }
    const trimmed = systemPrompt.trim();
    if (!trimmed) throw new BadRequestException('متن پرامپت خالی است');

    await this.prisma.llmPromptTemplate.upsert({
      where: { userId_purpose: { userId, purpose } },
      create: { userId, purpose, systemPrompt: trimmed },
      update: { systemPrompt: trimmed },
    });
    return { ok: true, purpose };
  }

  async resetPrompt(userId: string, purpose: string) {
    if (!isValidPromptPurpose(purpose)) {
      throw new BadRequestException('شناسه پرامپت نامعتبر است');
    }
    await this.prisma.llmPromptTemplate.deleteMany({ where: { userId, purpose } });
    return { ok: true, purpose };
  }

  private async adminUserId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      select: { id: true },
    });
    return admin?.id ?? null;
  }

  private async resolveCredentials(userId?: string, purpose?: string): Promise<LlmCreds> {
    const envFallbacks = parseModelList(this.config.get<string>('LLM_MODEL_FALLBACKS') ?? '');
    const settingsUserId = (await this.adminUserId()) ?? userId;

    if (settingsUserId) {
      const s = await this.prisma.llmSetting.findUnique({ where: { userId: settingsUserId } });
      if (s?.apiTokenEncrypted) {
        const models = parseModelList(s.model);
        return {
          baseUrl: s.baseUrl.replace(/\/$/, ''),
          model: models[0] ?? s.model,
          fallbackModels: [...models.slice(1), ...envFallbacks],
          apiKey: this.decryptToken(s.apiTokenEncrypted),
        };
      }
      if (s && !s.usePlatformFallback) {
        throw new Error('توکن LLM تنظیم نشده است');
      }
    }
    const apiKey = this.config.get<string>('PLATFORM_LLM_API_KEY');
    if (!apiKey) throw new Error('هیچ توکن LLM در دسترس نیست. در تنظیمات کلید خود را وارد کنید.');
    const primary = this.config.get<string>('PLATFORM_LLM_MODEL') ?? 'gpt-4o-mini';
    const models = parseModelList(primary);
    return {
      baseUrl: (this.config.get<string>('PLATFORM_LLM_BASE_URL') ?? 'https://api.openai.com/v1').replace(
        /\/$/,
        '',
      ),
      model: models[0] ?? primary,
      fallbackModels: [...models.slice(1), ...envFallbacks],
      apiKey,
    };
  }

  /**
   * اتصال جستجوی زنده (وب و X) از تنظیمات ادمین، جدا از مدل زبانی.
   * اگر نشانی یا کلید آن ذخیره نشده باشد، همان اتصال مدل زبانی برمی‌گردد.
   */
  private async searchCredentials(creds: LlmCreds): Promise<LlmCreds> {
    const adminId = await this.adminUserId();
    const row = adminId ? await this.prisma.llmSetting.findUnique({ where: { userId: adminId } }) : null;
    const baseUrl = row?.searchBaseUrl?.trim().replace(/\/+$/, '') ?? '';
    if (!baseUrl || !row?.searchTokenEncrypted) return creds;
    let apiKey = '';
    try {
      apiKey = this.decryptToken(row.searchTokenEncrypted);
    } catch {
      throw new Error('کلید سرویس جستجوی زنده خوانده نشد. آن را دوباره در تنظیمات ذخیره کنید.');
    }
    const models = parseModelList(row.searchModel ?? '');
    if (!models.length) {
      throw new Error('مدل سرویس جستجوی زنده در تنظیمات ادمین خالی است.');
    }
    return { baseUrl, apiKey, model: models[0], fallbackModels: models.slice(1) };
  }

  /** تصمیم System One. خروجی متن نیست؛ هر سؤال choice یا score یا noul است. */
  async systemOne(
    userId: string | undefined,
    purpose: string,
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
  ): Promise<Record<string, unknown>> {
    await this.aiUsage.assertAllowed(userId, purpose);
    let creds: { baseUrl: string; model: string; apiKey: string };
    try {
      creds = await this.systemOneCreds();
    } catch (e) {
      await this.recordFailure(purpose, userId, e, { history: true });
      throw e;
    }
    const body = JSON.stringify({ model: creds.model, state, questions });
    if (Buffer.byteLength(body, 'utf8') > 60_000) {
      const err = new BadRequestException('حجم زمینهٔ System One از سقف مدل بیشتر است.');
      await this.recordFailure(purpose, userId, err, {
        model: creds.model,
        prompt: body.slice(0, 4000),
        history: true,
      });
      throw err;
    }
    const url = creds.baseUrl.endsWith('/systemone') ? creds.baseUrl : `${creds.baseUrl}/systemone`;
    let lastStatus = 0;
    let lastText = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45_000);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': randomUUID(),
          },
          body,
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        lastStatus = response.status;
        lastText = await response.text();
        if (response.status === 429 && attempt === 0) {
          await sleep(2000);
          continue;
        }
        if (!response.ok) break;
        const json = JSON.parse(lastText) as Record<string, unknown>;
        const answers = systemOneAnswers(json);
        if (!answers) {
          lastStatus = response.status || 502;
          lastText = lastText || 'پاسخ System One جواب تصمیم نداشت.';
          break;
        }
        const usage = json.usage as { input_tokens?: number | null; output_tokens?: number | null } | undefined;
        const promptTokens = finite(usage?.input_tokens);
        const completionTokens = finite(usage?.output_tokens);
        const estimated = !(promptTokens > 0);
        const promptCount = estimated ? Math.max(1, Math.ceil(Buffer.byteLength(body, 'utf8') / 4)) : promptTokens;
        const modelName = typeof json.model === 'string' && json.model.trim() ? json.model : creds.model;
        await this.aiUsage.record(
          userId,
          purpose,
          modelName,
          {
            promptTokens: promptCount,
            completionTokens,
            totalTokens: promptCount + completionTokens,
            estimated,
          },
          {
            prompt: body.slice(0, 12000),
            response: JSON.stringify(answers).slice(0, 12000),
          },
        );
        return answers;
      } catch (e) {
        lastText = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    const detail = redactSecrets(lastText).slice(0, 4000);
    await this.recordFailure(
      purpose,
      userId,
      new LlmHttpError(detail || 'فراخوانی System One ناموفق بود.', lastStatus || 500, detail),
      {
        model: creds.model,
        prompt: body.slice(0, 4000),
        history: true,
      },
    );
    throw new BadRequestException(systemOneFailureFa(lastStatus, detail));
  }

  private async systemOneCreds(): Promise<{ baseUrl: string; model: string; apiKey: string }> {
    const adminId = await this.adminUserId();
    const row = adminId
      ? await this.prisma.llmSetting.findUnique({ where: { userId: adminId } })
      : null;
    const model = (row?.systemModel ?? '').split(/[,|\n]/).map((part) => part.trim()).find(Boolean) ?? '';
    let token = '';
    try {
      token = row?.systemOneTokenEncrypted ? this.decryptToken(row.systemOneTokenEncrypted) : '';
    } catch {
      throw new BadRequestException('کلید System One ذخیره شده خوانده نشد. آن را دوباره در تنظیمات ذخیره کنید.');
    }
    if (!model) throw new BadRequestException('مدل system-one در تنظیمات ادمین خالی است.');
    if (!token) throw new BadRequestException('کلید System One در تنظیمات ادمین ذخیره نشده است.');
    const baseUrl = (row?.systemOneBaseUrl?.trim() || 'https://system-one.dev/v1').replace(/\/$/, '');
    return { baseUrl, model, apiKey: token };
  }

  private requestHeaders(creds: LlmCreds): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (creds.baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] =
        this.config.get<string>('PUBLIC_URL')?.trim() ||
        this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() ||
        'https://sabad-yar.ir';
      headers['X-Title'] = 'Sabadyar';
      headers['X-OpenRouter-Title'] = 'Sabadyar';
    }
    return headers;
  }

  private extractJsonObject(content: string): unknown {
    const trimmed = content.trim();
    if (!trimmed) throw new Error('پاسخ خالی از مدل');

    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        return JSON.parse(fenced[1].trim());
      }
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(trimmed.slice(start, end + 1));
      }
      throw new Error('پاسخ مدل JSON معتبر نبود');
    }
  }

  private humanizeError(err: unknown): Error {
    if (err instanceof LlmHttpError && err.isRateLimited) {
      return new Error(
        'محدودیت نرخ OpenRouter (۴۲۹): مدل‌های رایگان موقتاً شلوغ‌اند. چند دقیقه صبر کنید، مدل‌های جایگزین را با ویرگول در تنظیمات بنویسید، یا در openrouter.ai اعتبار بخرید.',
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private async callChatCompletions(
    creds: LlmCreds,
    body: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<{ content: string; usage: TokenUse }> {
    const init = {
      method: 'POST',
      headers: this.requestHeaders(creds),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    };
    // fetch داخلی Node بیشتر از ۵ دقیقه منتظر پاسخ نمی‌ماند (headersTimeout)؛ برای سقف بلندتر کلاینت جدا
    const res = (
      timeoutMs > NODE_FETCH_WAIT_MS
        ? await undiciFetch(`${creds.baseUrl}/chat/completions`, { ...init, dispatcher: longWaitAgent(timeoutMs) })
        : await fetch(`${creds.baseUrl}/chat/completions`, init)
    ) as Response;

    const text = await res.text();
    if (!res.ok) {
      throw new LlmHttpError(`خطای LLM: ${res.status} ${text.slice(0, 800)}`, res.status, text);
    }

    let json: {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      error?: { message?: string; code?: number | string };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`پاسخ غیرJSON از LLM: ${text.slice(0, 300)}`);
    }

    if (json.error?.message) {
      const code = Number(json.error.code) || 0;
      throw new LlmHttpError(`خطای LLM: ${json.error.message}`, code || 500, json.error.message);
    }

    const raw = json.choices?.[0]?.message?.content;
    const content =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('')
          : '';
    return { content, usage: readTokenUse(json, JSON.stringify(body).length, content.length) };
  }

  /** تلاش روی چند مدل + retry برای ۴۲۹ */
  private async callWithModelFallback(
    creds: LlmCreds,
    makeBody: (model: string) => Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{ content: string; model: string; usage: TokenUse }> {
    const models = [creds.model, ...creds.fallbackModels].filter(
      (m, i, arr) => m && arr.indexOf(m) === i,
    );
    const maxAttemptsPerModel = 3;
    let lastErr: unknown;

    for (const model of models) {
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
        try {
          const result = await this.callChatCompletions(creds, makeBody(model), timeoutMs);
          return { content: result.content, model, usage: result.usage };
        } catch (e) {
          lastErr = e;
          const rateLimited = e instanceof LlmHttpError && e.isRateLimited;
          this.logger.warn(
            `LLM مدل=${model} تلاش=${attempt}/${maxAttemptsPerModel}: ${(e as Error).message.slice(0, 180)}`,
          );
          if (rateLimited && attempt < maxAttemptsPerModel) {
            await sleep(1500 * attempt * attempt);
            continue;
          }
          const gateway = e instanceof LlmHttpError && e.isGatewayTimeout;
          if (gateway && attempt === 1) {
            await sleep(1500);
            continue;
          }
          // برای ۴۲۹ برو سراغ مدل بعدی؛ برای بقیه خطاها اگر json_object بود لایه بالا retry می‌کند
          if (rateLimited) break;
          throw e;
        }
      }
    }

    throw this.humanizeError(lastErr);
  }

  private isXaiEndpoint(creds: LlmCreds): boolean {
    return /api\.x\.ai/i.test(creds.baseUrl);
  }

  private isGrokModel(model: string): boolean {
    return /grok/i.test(model);
  }

  private buildXSearchTool(search: LlmLiveSearch): Record<string, unknown> {
    const tool: Record<string, unknown> = { type: 'x_search' };
    if (search.fromDate) tool.from_date = search.fromDate;
    if (search.toDate) tool.to_date = search.toDate;
    return tool;
  }

  private searchToolSets(
    creds: LlmCreds,
    model: string,
    search: LlmLiveSearch,
  ): Record<string, unknown>[][] {
    const sets: Record<string, unknown>[][] = [];
    const xTool = this.buildXSearchTool(search);
    const grok = this.isGrokModel(model) || this.isXaiEndpoint(creds);
    if (search.x !== false && grok) {
      sets.push(search.web ? [xTool, { type: 'web_search' }] : [xTool]);
    }
    if (creds.baseUrl.includes('openrouter.ai')) {
      sets.push([{ type: 'openrouter:web_search', parameters: { max_results: 16 } }]);
    } else if (search.web && this.isXaiEndpoint(creds) && !sets.length) {
      sets.push([{ type: 'web_search' }]);
    }
    if (!sets.length && search.x !== false) {
      sets.push([xTool]);
    }
    // سرویس‌هایی که x_search ندارند (مثل Coarena) با جستجوی وب استاندارد امتحان می‌شوند
    if (!creds.baseUrl.includes('openrouter.ai')) {
      const hasWebOnly = sets.some((s) => s.length === 1 && s[0].type === 'web_search');
      if (!hasWebOnly) sets.push([{ type: 'web_search' }]);
    }
    return sets;
  }

  private extractResponsesText(json: Record<string, unknown>): string {
    if (typeof json.output_text === 'string' && json.output_text.trim()) {
      return json.output_text;
    }
    const parts: string[] = [];
    const output = json.output;
    if (Array.isArray(output)) {
      for (const item of output) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        if (rec.type === 'reasoning' || rec.type === 'web_search_call' || rec.type === 'x_search_call') {
          continue;
        }
        if (typeof rec.text === 'string') parts.push(rec.text);
        if (!Array.isArray(rec.content)) continue;
        for (const c of rec.content) {
          if (typeof c === 'string') {
            parts.push(c);
            continue;
          }
          if (!c || typeof c !== 'object') continue;
          const cr = c as Record<string, unknown>;
          if (typeof cr.text === 'string') parts.push(cr.text);
          if (typeof cr.output_text === 'string') parts.push(cr.output_text);
        }
      }
    }
    const joined = parts.join('\n').trim();
    if (joined) return joined;
    const choices = json.choices as
      | Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>
      | undefined;
    const raw = choices?.[0]?.message?.content;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
    }
    return '';
  }

  private extractCitations(json: Record<string, unknown>): string[] {
    const out: string[] = [];
    const top = json.citations;
    if (Array.isArray(top)) {
      for (const c of top) {
        if (typeof c === 'string' && c.trim()) out.push(c.trim());
        else if (c && typeof c === 'object' && typeof (c as { url?: unknown }).url === 'string') {
          out.push((c as { url: string }).url);
        }
      }
    }
    return [...new Set(out)].slice(0, 12);
  }

  private async postResponses(
    creds: LlmCreds,
    body: Record<string, unknown>,
  ): Promise<{ content: string; citations: string[]; usage: TokenUse }> {
    const res = await fetch(`${creds.baseUrl}/responses`, {
      method: 'POST',
      headers: this.requestHeaders(creds),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new LlmHttpError(`خطای LLM responses: ${res.status} ${text.slice(0, 800)}`, res.status, text);
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`پاسخ غیرJSON از LLM responses: ${text.slice(0, 300)}`);
    }
    const err = json.error as { message?: string; code?: number | string } | undefined;
    if (err?.message) {
      throw new LlmHttpError(`خطای LLM: ${err.message}`, Number(err.code) || 500, err.message);
    }
    const content = this.extractResponsesText(json);
    if (!content.trim()) {
      throw new Error('پاسخ خالی از جستجوی زندهٔ مدل');
    }
    return {
      content,
      citations: this.extractCitations(json),
      usage: readTokenUse(json, JSON.stringify(body).length, content.length),
    };
  }

  private async callResponsesForJson(
    creds: LlmCreds,
    systemPrompt: string,
    userPrompt: string,
    search: LlmLiveSearch,
    preferGrok?: boolean,
    once?: boolean,
  ): Promise<{ content: string; model: string; citations: string[]; usage: TokenUse }> {
    const ordered =
      preferGrok && !creds.pinPrimary
        ? preferGrokFirst(uniqueStrings([creds.model, ...creds.fallbackModels]))
        : uniqueStrings([creds.model, ...creds.fallbackModels]);
    const models = once ? ordered.slice(0, 1) : ordered;
    let lastErr: unknown;
    for (const model of models) {
      const sets = this.searchToolSets(creds, model, search);
      for (const tools of sets) {
        const baseBody: Record<string, unknown> = {
          model,
          instructions: systemPrompt,
          input: [{ role: 'user', content: userPrompt }],
          tools,
          temperature: 0.3,
        };
        const withJson = {
          ...baseBody,
          text: { format: { type: 'json_object' } },
        };
        if (once) {
          // فقط یک فراخوانی واقعی مدل؛ ابزار ردشده پیش از اجرای مدل برمی‌گردد و ابزار بعدی امتحان می‌شود
          try {
            const r = await this.postResponses(creds, withJson);
            this.logger.log(`جستجوی زنده مدل=${model} ابزار=${tools.map((t) => String(t.type ?? '')).join(',')}`);
            return { ...r, model };
          } catch (e) {
            if (!(e instanceof LlmHttpError && e.isUnsupportedTool)) throw e;
            lastErr = e;
            this.logger.warn(
              `ابزار ${tools.map((t) => String(t.type ?? '')).join(',')} روی این سرویس نیست؛ ابزار بعدی`,
            );
            continue;
          }
        }
        try {
          const r = await this.postResponses(creds, withJson);
          this.logger.log(`جستجوی زنده مدل=${model} ابزار=${tools.map((t) => String(t.type ?? '')).join(',')}`);
          return { ...r, model };
        } catch (e) {
          lastErr = e;
          this.logger.warn(
            `responses+json مدل=${model}: ${(e as Error).message.slice(0, 180)}`,
          );
          if (e instanceof LlmHttpError && (e.isRateLimited || e.isUnsupportedTool)) continue;
          try {
            const r = await this.postResponses(creds, baseBody);
            this.logger.log(`جستجوی زنده مدل=${model} بدون json_object`);
            return { ...r, model };
          } catch (e2) {
            lastErr = e2;
            this.logger.warn(`responses مدل=${model}: ${(e2 as Error).message.slice(0, 180)}`);
          }
        }
      }
    }
    throw this.humanizeError(lastErr ?? new Error(`جستجوی زندهٔ ${SOCIAL_NETWORK_LABEL_FA} در دسترس نبود`));
  }

  private async callChatJsonCompletions(
    creds: LlmCreds,
    systemPrompt: string,
    userPrompt: string,
    timeoutMs?: number,
  ): Promise<{ content: string; model: string; usage: TokenUse }> {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    try {
      return await this.callWithModelFallback(creds, (model) => ({
        model,
        temperature: 0.3,
        messages,
        response_format: { type: 'json_object' },
        ...(creds.baseUrl.includes('openrouter.ai') && creds.fallbackModels.length
          ? { models: [model, ...creds.fallbackModels.filter((m) => m !== model)] }
          : {}),
      }), timeoutMs);
    } catch (e) {
      if (e instanceof LlmHttpError && e.isGatewayTimeout) throw e;
      // سقف زمان دلخواه تمام شد؛ تلاش دوباره همان زمان را دوباره هدر می‌دهد
      if (timeoutMs && isRequestTimeout(e)) {
        throw new Error(`پاسخ مدل در ${Math.round(timeoutMs / 60_000)} دقیقه نرسید (time out)`);
      }
      if (e instanceof LlmHttpError && e.isRateLimited) throw this.humanizeError(e);
      this.logger.warn(`chatJson با json_object ناموفق، تلاش بدون آن: ${(e as Error).message}`);
      return this.callWithModelFallback(creds, (model) => ({
        model,
        temperature: 0.3,
        messages,
      }), timeoutMs);
    }
  }

  async chatJson<T>(
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    userId?: string,
    options?: LlmChatOptions,
  ): Promise<T> {
    await this.aiUsage.assertAllowed(userId, purpose);
    try {
      return await this.chatJsonInner<T>(purpose, systemPrompt, userPrompt, userId, options);
    } catch (e) {
      let model: string | undefined;
      try {
        model = (await this.resolveCredentials(userId, purpose)).model;
      } catch {
        model = undefined;
      }
      await this.recordFailure(purpose, userId, e, {
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        model,
        history: !options?.errorLogOnly,
      });
      throw this.humanizeError(e);
    }
  }

  private async chatJsonInner<T>(
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    userId?: string,
    options?: LlmChatOptions,
  ): Promise<T> {
    const creds = await this.resolveCredentials(userId, purpose);
    const search = normalizeLiveSearch(options?.liveSearch);
    const hideNetworkBrand = NEWS_LLM_PURPOSES.has(purpose) || (Boolean(search) && search?.x !== false);
    const system = hideNetworkBrand ? appendSocialNetworkOutputRule(systemPrompt) : systemPrompt;
    let usedModel = creds.model;
    let content: string;
    let citations: string[] = [];
    let usage: TokenUse = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true };

    if (search) {
      try {
        const r = await this.callResponsesForJson(
          await this.searchCredentials(creds),
          system,
          userPrompt,
          search,
          options?.preferGrok,
          options?.once,
        );
        content = r.content;
        usedModel = r.model;
        citations = r.citations;
        usage = r.usage;
      } catch (e) {
        if (options?.once) throw e;
        this.logger.warn(
          `جستجوی زندهٔ ${SOCIAL_NETWORK_LABEL_FA} ناموفق؛ ادامه بدون ابزار جستجو: ${(e as Error).message.slice(0, 180)}`,
        );
        const r = await this.callChatJsonCompletions(creds, system, userPrompt, options?.timeoutMs);
        content = r.content;
        usedModel = r.model;
        usage = r.usage;
      }
    } else {
      const r = await this.callChatJsonCompletions(creds, system, userPrompt, options?.timeoutMs);
      content = r.content;
      usedModel = r.model;
      usage = r.usage;
    }

    const responseText = citations.length ? `${content}\n---\n${citations.join('\n')}` : content;
    await this.aiUsage.record(userId, purpose, usedModel, usage, {
      prompt: `${system}\n---\n${userPrompt}`,
      response: responseText,
    });

    const parsed = this.extractJsonObject(content) as T;
    if (citations.length && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as { sourceNoteFa?: string };
      if (!rec.sourceNoteFa?.trim()) {
        rec.sourceNoteFa = `جستجوی زندهٔ ${SOCIAL_NETWORK_LABEL_FA}`;
      }
    }
    return hideNetworkBrand ? redactSocialNetworkBrandInFaFields(parsed) : parsed;
  }

  async speakTts(
    text: string,
    userId?: string,
    opts?: {
      model?: string;
      voice?: string;
      instructions?: string;
      baseUrl?: string;
      apiKey?: string;
      /** بخش سوابق هوش مصنوعی؛ پیش‌فرض tts که «سیستم» نشان داده می‌شود */
      purpose?: string;
    },
  ): Promise<Buffer> {
    const purpose = opts?.purpose ?? 'tts';
    const creds = await this.resolveTtsCredentials(userId);
    const baseUrl = opts?.baseUrl?.trim() || creds.baseUrl;
    const apiKey = opts?.apiKey?.trim() || creds.apiKey;
    const input = text.replace(/\s+/g, ' ').trim().slice(0, 4096);
    if (!input) throw new Error('متن خالی برای گفتار');
    const savedSpeech = await this.adminSpeechChoice();
    const requestedModel = opts?.model?.trim() || savedSpeech.model;
    const model = speechModelForBase(baseUrl, requestedModel);
    const voice = opts?.voice?.trim() || savedSpeech.voice;
    if (model !== requestedModel) {
      this.logger.warn(`مدل گفتار ${requestedModel} با این نشانی سازگار نیست؛ ${model} استفاده شد`);
    }
    const instructions =
      !isGapGptBase(baseUrl) && speechModelAcceptsInstructions(model)
        ? (opts?.instructions ?? 'Speak in fluent, clear Persian (Farsi). Natural pace.')
        : undefined;
    const url = audioSpeechUrl(baseUrl);
    const maxChunk = 4096;
    const chunks = splitSpeechInput(input, maxChunk);
    const pieces: Buffer[] = [];
    let audio: Buffer;
    try {
      for (const chunk of chunks) {
        pieces.push(await this.requestSpeech(url, apiKey, model, voice, chunk, instructions));
      }
      audio = Buffer.concat(pieces);
    } catch (e) {
      await this.recordFailure(purpose, userId, e, { prompt: input, model });
      throw e;
    }
    const promptTokens = Math.max(1, Math.ceil(input.length / 4));
    await this.aiUsage.record(userId, purpose, model, {
      promptTokens,
      completionTokens: 0,
      totalTokens: promptTokens,
      estimated: true,
    }, {
      prompt: input,
      response: `صوت ساخته شد. ${pieces.length.toLocaleString('en-US')} قطعه، ${audio.length.toLocaleString('en-US')} بایت.`,
    });
    return audio;
  }

  private async requestSpeech(
    url: string,
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    instructions?: string,
  ): Promise<Buffer> {
    try {
      return await this.postSpeech(url, apiKey, model, voice, input, instructions);
    } catch (e) {
      const rateLimited = e instanceof Error && /خطای TTS: 429/.test(e.message);
      if (!rateLimited) throw e instanceof Error ? e : new Error(String(e));
      this.logger.warn(`گفتار ${model} با محدودیت نرخ؛ یک بار دیگر همان مدل.`);
      await sleep(2000);
      return this.postSpeech(url, apiKey, model, voice, input, instructions);
    }
  }

  private async postSpeech(
    url: string,
    apiKey: string,
    model: string,
    voice: string,
    input: string,
    instructions?: string,
  ): Promise<Buffer> {
    const body: Record<string, string> = { model, voice, input };
    if (instructions && speechModelAcceptsInstructions(model)) body.instructions = instructions;
    const where = speechEndpointLabel(url);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55_000),
      });
    } catch (e) {
      if (isSpeechTimeout(e)) {
        throw new Error(`پاسخ گفتار نرسید.\nمدل: ${model}\nصدا: ${voice}\nنشانی: ${where}\n${errorText(e)}`);
      }
      throw new Error(`اتصال گفتار برقرار نشد.\nمدل: ${model}\nصدا: ${voice}\nنشانی: ${where}\n${errorText(e)}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    const asText = audio.toString('utf8');
    const notAudio = asText.trim().startsWith('{') || asText.trim().startsWith('<');
    if (!res.ok || notAudio || audio.length < 64) {
      throw new Error(
        `خطای TTS: ${res.status}\nمدل: ${model}\nصدا: ${voice}\nنشانی: ${where}\n${asText.slice(0, 3500)}`,
      );
    }
    return audio;
  }

  private gapWalletCache: { at: number; value: GapGptWallet } | null = null;

  /** موجودی کیف پول گپ از مسیر صورتحساب سازگار با OpenAI. گپ این عدد را ریال برنمی‌گرداند. */
  async gapGptWallet(): Promise<GapGptWallet> {
    const cached = this.gapWalletCache;
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const value = await this.loadGapGptWallet();
    this.gapWalletCache = { at: Date.now(), value };
    return value;
  }

  private async loadGapGptWallet(): Promise<GapGptWallet> {
    const empty = (messageFa: string, gapgpt = false): GapGptWallet => ({
      ok: false,
      gapgpt,
      unlimited: false,
      remainUsd: null,
      usedUsd: null,
      remainRial: null,
      usedRial: null,
      usdIrr: null,
      nativeRial: false,
      messageFa,
    });
    let creds: LlmCreds;
    try {
      creds = await this.resolveCredentials();
    } catch (e) {
      return empty((e as Error).message || 'توکن مدل مدیر در دسترس نیست.');
    }
    if (!isGapGptBase(creds.baseUrl)) {
      return empty('نشانی مدل مدیر، گپ‌جی‌پی‌تی نیست. باقی‌مانده فقط برای همین سرویس خوانده می‌شود.');
    }
    const headers = { Authorization: `Bearer ${creds.apiKey}`, Accept: 'application/json' };
    try {
      const [subRes, useRes] = await Promise.all([
        fetch(`${creds.baseUrl}/dashboard/billing/subscription`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        }),
        fetch(`${creds.baseUrl}/dashboard/billing/usage`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        }),
      ]);
      const subText = await subRes.text();
      const useText = await useRes.text();
      if (!subRes.ok) {
        return empty(`گپ موجودی را نداد (${subRes.status}).`, true);
      }
      const sub = parseJsonRecord(subText);
      const use = useRes.ok ? parseJsonRecord(useText) : null;
      const errorMessage = textOf(sub?.error);
      if (errorMessage) return empty(errorMessage, true);
      const native = firstRial(sub) ?? firstRial(use);
      const spot = await this.prisma.spotPriceDaily.findFirst({
        orderBy: { dateKey: 'desc' },
        select: { usdIrr: true },
      });
      const usdIrr = spot?.usdIrr != null && spot.usdIrr > 0 ? spot.usdIrr : null;
      if (native != null) {
        return {
          ok: true,
          gapgpt: true,
          unlimited: false,
          remainUsd: null,
          usedUsd: null,
          remainRial: native.remain,
          usedRial: native.used,
          usdIrr,
          nativeRial: true,
          messageFa: 'موجودی ریالی مستقیم از پاسخ گپ خوانده شد.',
        };
      }
      const limit = finiteNumber(sub?.hard_limit_usd ?? sub?.soft_limit_usd);
      const unlimited = limit != null && limit >= 100_000_000;
      if (unlimited) {
        return {
          ok: true,
          gapgpt: true,
          unlimited: true,
          remainUsd: null,
          usedUsd: null,
          remainRial: null,
          usedRial: null,
          usdIrr,
          nativeRial: false,
          messageFa: 'سقف این کلید در گپ نامحدود است. باقی‌ماندهٔ کیف پول از این مسیر برنمی‌گردد.',
        };
      }
      const usedRaw = finiteNumber(use?.total_usage);
      if (limit == null || usedRaw == null) {
        return empty('پاسخ صورتحساب گپ عدد باقی‌مانده نداشت.', true);
      }
      const usedUsd = usedRaw / 100;
      const remainUsd = Math.max(0, limit - usedUsd);
      const remainRial = usdIrr != null ? Math.round(remainUsd * usdIrr) : null;
      const usedRial = usdIrr != null ? Math.round(usedUsd * usdIrr) : null;
      return {
        ok: true,
        gapgpt: true,
        unlimited: false,
        remainUsd,
        usedUsd,
        remainRial,
        usedRial,
        usdIrr,
        nativeRial: false,
        messageFa:
          usdIrr != null
            ? 'گپ موجودی را به دلارِ اعتبار برمی‌گرداند. ریال با آخرین نرخ دلار ذخیره‌شده حساب شده است.'
            : 'گپ موجودی را به دلارِ اعتبار برمی‌گرداند. نرخ دلار در اقتصاد ایران نیست، پس معادل ریالی حساب نشد.',
      };
    } catch (e) {
      return empty(`خواندن موجودی گپ ناموفق بود: ${(e as Error).message}`, true);
    }
  }

  async speechAccess(userId?: string): Promise<{ baseUrl: string; apiKey: string }> {
    const creds = await this.resolveTtsCredentials(userId);
    return { baseUrl: creds.baseUrl, apiKey: creds.apiKey };
  }

  /** نشانی و کلید رونویسی فقط از تنظیمات ادمین. مدل همیشه در کلاینت whisper-1 ثابت است. */
  async transcriptionAccess(userId?: string): Promise<{ baseUrl: string; apiKey: string }> {
    const creds = await this.resolveTtsCredentials(userId);
    return { baseUrl: creds.baseUrl, apiKey: creds.apiKey };
  }

  async transcribeAudio(
    audio: Buffer,
    filename: string,
    userId?: string,
    purpose = 'transcription',
    requestFa?: string,
  ): Promise<string> {
    const access = await this.transcriptionAccess(userId);
    const pieces = await transcribeBytes(audio, filename || 'audio.m4a', access.baseUrl, access.apiKey);
    const text = pieces
      .map((p) => p.text)
      .join(' ')
      .trim();
    await this.recordTranscription(userId, purpose, {
      text,
      requestFa: [requestFa, `فایل صوتی: ${filename || 'audio'}`, `حجم: ${audio.length.toLocaleString('en-US')} بایت`]
        .filter(Boolean)
        .join('\n'),
    });
    return text;
  }

  /**
   * ثبت مصرف رونویسی صدا که بیرون از transcribeAudio انجام شده (مثل زیرنویس ویدئو).
   * توکن از طول متن تخمین زده می‌شود چون whisper توکن برنمی‌گرداند.
   */
  async recordTranscription(
    userId: string | undefined,
    purpose: string,
    info: { text: string; requestFa: string; seconds?: number | null },
  ) {
    const tokens = Math.max(1, Math.ceil(info.text.length / 4));
    const duration =
      info.seconds && info.seconds > 0 ? `مدت صدا: ${Math.round(info.seconds).toLocaleString('en-US')} ثانیه` : '';
    await this.aiUsage.record(
      userId,
      purpose,
      'whisper-1',
      { promptTokens: tokens, completionTokens: 0, totalTokens: tokens, estimated: true },
      { prompt: [info.requestFa, duration].filter(Boolean).join('\n'), response: info.text },
    );
  }

  private async resolveTtsCredentials(userId?: string): Promise<LlmCreds> {
    const creds = await this.resolveCredentials(userId);
    return { ...creds, fallbackModels: [] };
  }

  /** مدل و صدای گفتار فقط از تنظیمات ربات تلگرام. فایل env خوانده نمی‌شود. */
  private async adminSpeechChoice(): Promise<{ model: string; voice: string }> {
    const row = await this.prisma.telegramBotConfig.findUnique({ where: { id: 'default' } });
    return {
      model: row?.ttsModel?.trim() || 'gpt-4o-mini-tts',
      voice: row?.ttsVoice?.trim() || 'alloy',
    };
  }

  async chatText(purpose: string, systemPrompt: string, userPrompt: string, userId?: string) {
    await this.aiUsage.assertAllowed(userId, purpose);
    const creds = await this.resolveCredentials(userId, purpose);
    try {
      const { content, model, usage } = await this.callWithModelFallback(creds, (m) => ({
        model: m,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }));
      await this.aiUsage.record(userId, purpose, model, usage, {
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        response: content,
      });
      return content;
    } catch (e) {
      await this.recordFailure(purpose, userId, e, {
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        model: creds.model,
      });
      throw this.humanizeError(e);
    }
  }

  async listErrors() {
    const rows = await this.prisma.llmErrorLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      statusCode: row.statusCode,
      message: row.message,
      detail: row.detail,
      createdAt: row.createdAt,
    }));
  }

  async clearErrors() {
    const result = await this.prisma.llmErrorLog.deleteMany();
    return { deleted: result.count };
  }

  private async recordFailure(
    purpose: string,
    userId: string | undefined,
    err: unknown,
    exchange?: { prompt?: string; model?: string; history?: boolean },
  ) {
    try {
      const raw =
        err instanceof LlmHttpError
          ? err.body || err.message
          : err instanceof Error
            ? err.message
            : String(err);
      const detail = redactSecrets(raw).slice(0, 20000);
      const message = redactSecrets(err instanceof Error ? err.message : raw).slice(0, 4000);
      await this.prisma.llmErrorLog.create({
        data: {
          userId: userId ?? null,
          purpose,
          statusCode: err instanceof LlmHttpError ? err.status : null,
          message,
          detail,
        },
      });
      if (exchange?.history !== false) {
        await this.aiUsage.record(
          userId,
          purpose,
          exchange?.model,
          { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false },
          { prompt: exchange?.prompt, response: detail, ok: false },
        );
      }
    } catch (logErr) {
      this.logger.warn(`ثبت خطای LLM ناموفق: ${(logErr as Error).message}`);
    }
  }

  /**
   * تست اتصال و پاسخ‌گویی LLM.
   * اگر baseUrl/model/apiToken در body بیاید، همان تنظیمات پیش‌نویس تست می‌شود (بدون ذخیره).
   */
  async testConnection(
    userId: string,
    draft?: { baseUrl?: string; model?: string; apiToken?: string },
  ) {
    const started = Date.now();
    let testedModel: string | undefined;
    try {
      let creds: LlmCreds;
      if (draft?.baseUrl || draft?.model || draft?.apiToken) {
        const saved = await this.prisma.llmSetting.findUnique({ where: { userId } });
        const token =
          draft.apiToken?.trim() ||
          (saved?.apiTokenEncrypted ? this.decryptToken(saved.apiTokenEncrypted) : '') ||
          this.config.get<string>('PLATFORM_LLM_API_KEY') ||
          '';
        if (!token) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            error: 'توکن API برای تست موجود نیست. ابتدا کلید را وارد و ذخیره کنید.',
            messageFa: 'توکن API برای تست موجود نیست. ابتدا کلید را وارد و ذخیره کنید.',
          };
        }
        const modelRaw = (draft.model ?? saved?.model ?? 'gpt-4o-mini').trim();
        const models = parseModelList(modelRaw);
        const baseUrl = (draft.baseUrl ?? saved?.baseUrl ?? 'https://api.openai.com/v1')
          .trim()
          .replace(/\/$/, '');
        creds = {
          baseUrl,
          model: models[0] ?? modelRaw,
          fallbackModels: models.slice(1),
          apiKey: token,
        };
      } else {
        creds = await this.resolveCredentials(userId);
      }

      testedModel = creds.model;
      const { content, model, usage } = await this.callWithModelFallback(creds, (m) => ({
        model: m,
        temperature: 0,
        max_tokens: 40,
        messages: [
          {
            role: 'system',
            content: 'You are a connectivity test. Reply with exactly: OK',
          },
          {
            role: 'user',
            content: 'ping',
          },
        ],
      }));

      const reply = (content || '').trim().slice(0, 200);
      await this.aiUsage.record(userId, 'llm_test', model, usage, {
        prompt: 'You are a connectivity test. Reply with exactly: OK\n---\nping',
        response: content || '',
      });
      const latencyMs = Date.now() - started;
      return {
        ok: true,
        latencyMs,
        baseUrl: creds.baseUrl,
        model,
        reply: reply || '(پاسخ خالی)',
        messageFa: `اتصال برقرار است. مدل «${model}» در ${latencyMs.toLocaleString('fa-IR')} میلی‌ثانیه پاسخ داد.`,
      };
    } catch (e) {
      await this.recordFailure('llm_test', userId, e, {
        prompt: 'ping',
        model: testedModel,
      });
      const latencyMs = Date.now() - started;
      const err = this.humanizeError(e);
      return {
        ok: false,
        latencyMs,
        error: err.message,
        messageFa: `تست ناموفق: ${err.message}`,
      };
    }
  }
}

/** پیش‌فرض headersTimeout و bodyTimeout در fetch داخلی Node */
const NODE_FETCH_WAIT_MS = 300_000;
const longWaitAgents = new Map<number, Agent>();

/** کلاینتی که تا سقف خواسته‌شده منتظر سرآیند و بدنهٔ پاسخ مدل می‌ماند؛ برای هر سقف یکی ساخته و نگه داشته می‌شود */
function longWaitAgent(timeoutMs: number): Agent {
  let agent = longWaitAgents.get(timeoutMs);
  if (!agent) {
    agent = new Agent({ headersTimeout: timeoutMs + 5_000, bodyTimeout: timeoutMs + 5_000 });
    longWaitAgents.set(timeoutMs, agent);
  }
  return agent;
}

function isRequestTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: string } }).cause?.code ?? '';
  return (
    error.name === 'TimeoutError' ||
    error.name === 'AbortError' ||
    /UND_ERR_(HEADERS|BODY)_TIMEOUT/.test(cause) ||
    /aborted due to timeout/i.test(error.message)
  );
}

function isSpeechTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return /aborted due to timeout|operation was aborted|پاسخ گفتار نرسید/i.test(error.message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTokenUse(json: unknown, promptChars: number, completionChars: number): TokenUse {
  const usage =
    json && typeof json === 'object' && 'usage' in json
      ? (json as { usage?: Record<string, unknown> }).usage
      : undefined;
  const prompt = finite(usage?.prompt_tokens ?? usage?.input_tokens);
  const completion = finite(usage?.completion_tokens ?? usage?.output_tokens);
  const total = finite(usage?.total_tokens) || prompt + completion;
  if (total > 0) {
    return {
      promptTokens: prompt,
      completionTokens: completion || Math.max(0, total - prompt),
      totalTokens: total,
      estimated: false,
    };
  }
  const promptTokens = Math.max(1, Math.ceil(promptChars / 4));
  const completionTokens = Math.max(0, Math.ceil(completionChars / 4));
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

function finite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return null;
}

function firstRial(row: Record<string, unknown> | null): { remain: number; used: number | null } | null {
  if (!row) return null;
  const remainKey = ['remain_rial', 'balance_rial', 'balance_irr', 'remaining_irr', 'quota_irr'].find(
    (key) => finiteNumber(row[key]) != null,
  );
  if (remainKey) {
    const remain = finiteNumber(row[remainKey]);
    const used = finiteNumber(row.used_rial ?? row.used_irr);
    return remain == null ? null : { remain: Math.max(0, Math.round(remain)), used: used == null ? null : Math.round(used) };
  }
  const tomanKey = ['remain_toman', 'balance_toman', 'balance_irt', 'remaining_irt'].find(
    (key) => finiteNumber(row[key]) != null,
  );
  if (!tomanKey) return null;
  const toman = finiteNumber(row[tomanKey]);
  const usedToman = finiteNumber(row.used_toman ?? row.used_irt);
  if (toman == null) return null;
  return {
    remain: Math.max(0, Math.round(toman * 10)),
    used: usedToman == null ? null : Math.round(usedToman * 10),
  };
}

function speechEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'audio/speech';
  }
}
