import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROMPT_DEFAULTS, isValidPromptPurpose } from './prompt-defaults';
import {
  NEWS_LLM_PURPOSES,
  SOCIAL_NETWORK_LABEL_FA,
  appendSocialNetworkOutputRule,
  redactSocialNetworkBrandInFaFields,
} from './social-source-wording';

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
  ): Promise<{ content: string; citations: string[] }> {
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
    return { content, citations: this.extractCitations(json) };
  }

  private async callResponsesForJson(
    creds: LlmCreds,
    systemPrompt: string,
    userPrompt: string,
    search: LlmLiveSearch,
    preferGrok?: boolean,
  ): Promise<{ content: string; model: string; citations: string[] }> {
    const models = preferGrok
      ? preferGrokFirst(uniqueStrings([creds.model, ...creds.fallbackModels]))
      : uniqueStrings([creds.model, ...creds.fallbackModels]);
    let lastErr: unknown;
    for (const model of models) {
      const toolSets = this.searchToolSets(creds, model, search);
      for (const tools of toolSets) {
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
        try {
          const r = await this.postResponses(creds, withJson);
          this.logger.log(`جستجوی زنده مدل=${model} ابزار=${tools.map((t) => String(t.type ?? '')).join(',')}`);
          return { ...r, model };
        } catch (e) {
          lastErr = e;
          this.logger.warn(
            `responses+json مدل=${model}: ${(e as Error).message.slice(0, 180)}`,
          );
          if (e instanceof LlmHttpError && e.isRateLimited) continue;
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
  ): Promise<{ content: string; model: string }> {
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
      }));
    } catch (e) {
      if (e instanceof LlmHttpError && e.isRateLimited) throw this.humanizeError(e);
      this.logger.warn(`chatJson با json_object ناموفق، تلاش بدون آن: ${(e as Error).message}`);
      return this.callWithModelFallback(creds, (model) => ({
        model,
        temperature: 0.3,
        messages,
      }));
    }
  }

  async chatJson<T>(
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    userId?: string,
    options?: LlmChatOptions,
  ): Promise<T> {
    const creds = await this.resolveCredentials(userId);
    const search = normalizeLiveSearch(options?.liveSearch);
    const hideNetworkBrand = NEWS_LLM_PURPOSES.has(purpose) || (Boolean(search) && search?.x !== false);
    const system = hideNetworkBrand ? appendSocialNetworkOutputRule(systemPrompt) : systemPrompt;
    let usedModel = creds.model;
    let content: string;
    let citations: string[] = [];

    if (search) {
      try {
        const r = await this.callResponsesForJson(creds, system, userPrompt, search, options?.preferGrok);
        content = r.content;
        usedModel = r.model;
        citations = r.citations;
      } catch (e) {
        this.logger.warn(
          `جستجوی زندهٔ ${SOCIAL_NETWORK_LABEL_FA} ناموفق؛ ادامه بدون ابزار جستجو: ${(e as Error).message.slice(0, 180)}`,
        );
        const r = await this.callChatJsonCompletions(creds, system, userPrompt);
        content = r.content;
        usedModel = r.model;
      }
    } else {
      const r = await this.callChatJsonCompletions(creds, system, userPrompt);
      content = r.content;
      usedModel = r.model;
    }

    await this.prisma.aiTrace.create({
      data: {
        userId,
        purpose,
        prompt: `${system}\n---\n${userPrompt}`,
        response: citations.length ? `${content}\n---\n${citations.join('\n')}` : content,
        model: usedModel,
      },
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
    opts?: { model?: string; voice?: string; instructions?: string },
  ): Promise<Buffer> {
    const creds = await this.resolveTtsCredentials(userId);
    const input = text.replace(/\s+/g, ' ').trim().slice(0, 4096);
    if (!input) throw new Error('متن خالی برای گفتار');
    const res = await fetch(`${creds.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:
          opts?.model?.trim() ||
          this.config.get<string>('TTS_MODEL') ||
          'gpt-4o-mini-tts',
        voice: opts?.voice ?? this.config.get<string>('TTS_VOICE') ?? 'nova',
        input,
        response_format: 'mp3',
        instructions:
          opts?.instructions ?? 'Speak in fluent, clear Persian (Farsi). Natural pace.',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`خطای TTS: ${res.status} ${errText.slice(0, 240)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async transcribeAudio(audio: Buffer, filename: string, userId?: string): Promise<string> {
    const creds = await this.resolveTtsCredentials(userId);
    const form = new FormData();
    const mime = filename.endsWith('.webm')
      ? 'audio/webm'
      : filename.endsWith('.m4a') || filename.endsWith('.mp4')
        ? 'audio/mp4'
        : filename.endsWith('.ogg')
          ? 'audio/ogg'
          : 'audio/mpeg';
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), filename);
    form.append('model', 'whisper-1');
    form.append('response_format', 'text');
    const res = await fetch(`${creds.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`خطای رونویسی: ${res.status} ${text.slice(0, 240)}`);
    return text.trim();
  }

  private async resolveTtsCredentials(userId?: string): Promise<LlmCreds> {
    const creds = await this.resolveCredentials(userId);
    return {
      ...creds,
      model: this.config.get<string>('TTS_MODEL') ?? 'gpt-4o-mini-tts',
      fallbackModels: [],
    };
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

  /**
   * تست اتصال و پاسخ‌گویی LLM.
   * اگر baseUrl/model/apiToken در body بیاید، همان تنظیمات پیش‌نویس تست می‌شود (بدون ذخیره).
   */
  async testConnection(
    userId: string,
    draft?: { baseUrl?: string; model?: string; apiToken?: string },
  ) {
    const started = Date.now();
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

      const { content, model } = await this.callWithModelFallback(creds, (m) => ({
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
