import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROMPT_DEFAULTS, isValidPromptPurpose } from './prompt-defaults';

type LlmCreds = { baseUrl: string; model: string; apiKey: string; fallbackModels: string[] };

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

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private key(): Buffer {
    const raw = this.config.get<string>('LLM_TOKEN_ENCRYPTION_KEY') ?? '0123456789abcdef0123456789abcdef';
    return scryptSync(raw, 'sabadyar-salt', 32);
  }

  encryptToken(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  decryptToken(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  async saveSettings(
    userId: string,
    data: { baseUrl?: string; model?: string; apiToken?: string; usePlatformFallback?: boolean },
  ) {
    const update: Record<string, unknown> = {};
    if (data.baseUrl !== undefined) update.baseUrl = data.baseUrl.trim().replace(/\/$/, '');
    if (data.model !== undefined) update.model = data.model.trim();
    if (data.usePlatformFallback !== undefined) update.usePlatformFallback = data.usePlatformFallback;
    if (data.apiToken) update.apiTokenEncrypted = this.encryptToken(data.apiToken.trim());

    return this.prisma.llmSetting.upsert({
      where: { userId },
      create: {
        userId,
        baseUrl: (data.baseUrl ?? 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
        model: (data.model ?? 'gpt-4o-mini').trim(),
        apiTokenEncrypted: data.apiToken ? this.encryptToken(data.apiToken.trim()) : undefined,
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
      usePlatformFallback: s.usePlatformFallback,
      hasToken: Boolean(s.apiTokenEncrypted),
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
    return custom?.systemPrompt ?? fallback;
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

  private async resolveCredentials(userId?: string): Promise<LlmCreds> {
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

  private requestHeaders(creds: LlmCreds): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (creds.baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] =
        this.config.get<string>('CORS_ORIGIN')?.split(',')[0]?.trim() || 'https://sabadyar.local';
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
  ): Promise<string> {
    const res = await fetch(`${creds.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.requestHeaders(creds),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

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
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
    }
    return '';
  }

  /** تلاش روی چند مدل + retry برای ۴۲۹ */
  private async callWithModelFallback(
    creds: LlmCreds,
    makeBody: (model: string) => Record<string, unknown>,
  ): Promise<{ content: string; model: string }> {
    const models = [creds.model, ...creds.fallbackModels].filter(
      (m, i, arr) => m && arr.indexOf(m) === i,
    );
    const maxAttemptsPerModel = 3;
    let lastErr: unknown;

    for (const model of models) {
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
        try {
          const content = await this.callChatCompletions(creds, makeBody(model));
          return { content, model };
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
          // برای ۴۲۹ برو سراغ مدل بعدی؛ برای بقیه خطاها اگر json_object بود لایه بالا retry می‌کند
          if (rateLimited) break;
          throw e;
        }
      }
    }

    throw this.humanizeError(lastErr);
  }

  async chatJson<T>(
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    userId?: string,
  ): Promise<T> {
    const creds = await this.resolveCredentials(userId);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let usedModel = creds.model;
    let content: string;
    try {
      const r = await this.callWithModelFallback(creds, (model) => ({
        model,
        temperature: 0.3,
        messages,
        response_format: { type: 'json_object' },
        ...(creds.baseUrl.includes('openrouter.ai') && creds.fallbackModels.length
          ? { models: [model, ...creds.fallbackModels.filter((m) => m !== model)] }
          : {}),
      }));
      content = r.content;
      usedModel = r.model;
    } catch (e) {
      if (e instanceof LlmHttpError && e.isRateLimited) throw this.humanizeError(e);
      this.logger.warn(`chatJson با json_object ناموفق، تلاش بدون آن: ${(e as Error).message}`);
      try {
        const r = await this.callWithModelFallback(creds, (model) => ({
          model,
          temperature: 0.3,
          messages,
        }));
        content = r.content;
        usedModel = r.model;
      } catch (e2) {
        throw this.humanizeError(e2);
      }
    }

    await this.prisma.aiTrace.create({
      data: {
        userId,
        purpose,
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        response: content,
        model: usedModel,
      },
    });

    return this.extractJsonObject(content) as T;
  }

  async chatText(purpose: string, systemPrompt: string, userPrompt: string, userId?: string) {
    const creds = await this.resolveCredentials(userId);
    try {
      const { content, model } = await this.callWithModelFallback(creds, (m) => ({
        model: m,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }));
      await this.prisma.aiTrace.create({
        data: {
          userId,
          purpose,
          prompt: `${systemPrompt}\n---\n${userPrompt}`,
          response: content,
          model,
        },
      });
      return content;
    } catch (e) {
      throw this.humanizeError(e);
    }
  }
}
