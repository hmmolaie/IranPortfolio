import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type LlmCreds = { baseUrl: string; model: string; apiKey: string };

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

  private async resolveCredentials(userId?: string): Promise<LlmCreds> {
    if (userId) {
      const s = await this.prisma.llmSetting.findUnique({ where: { userId } });
      if (s?.apiTokenEncrypted) {
        return {
          baseUrl: s.baseUrl.replace(/\/$/, ''),
          model: s.model,
          apiKey: this.decryptToken(s.apiTokenEncrypted),
        };
      }
      if (s && !s.usePlatformFallback) {
        throw new Error('توکن LLM تنظیم نشده است');
      }
    }
    const apiKey = this.config.get<string>('PLATFORM_LLM_API_KEY');
    if (!apiKey) throw new Error('هیچ توکن LLM در دسترس نیست. در تنظیمات کلید خود را وارد کنید.');
    return {
      baseUrl: (this.config.get<string>('PLATFORM_LLM_BASE_URL') ?? 'https://api.openai.com/v1').replace(
        /\/$/,
        '',
      ),
      model: this.config.get<string>('PLATFORM_LLM_MODEL') ?? 'gpt-4o-mini',
      apiKey,
    };
  }

  private requestHeaders(creds: LlmCreds): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.apiKey}`,
      'Content-Type': 'application/json',
    };
    // OpenRouter: هدرهای توصیه‌شده برای شناسایی اپ
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
      // بلوک ```json ... ```
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
      throw new Error(`خطای LLM: ${res.status} ${text.slice(0, 800)}`);
    }

    let json: {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      error?: { message?: string };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`پاسخ غیرJSON از LLM: ${text.slice(0, 300)}`);
    }

    if (json.error?.message) {
      throw new Error(`خطای LLM: ${json.error.message}`);
    }

    const raw = json.choices?.[0]?.message?.content;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
    }
    return '';
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

    const baseBody: Record<string, unknown> = {
      model: creds.model,
      temperature: 0.3,
      messages,
    };

    let content: string;
    try {
      // بعضی مدل‌های رایگان OpenRouter از response_format پشتیبانی نمی‌کنند
      content = await this.callChatCompletions(creds, {
        ...baseBody,
        response_format: { type: 'json_object' },
      });
    } catch (e) {
      this.logger.warn(`chatJson با json_object ناموفق، تلاش بدون آن: ${(e as Error).message}`);
      content = await this.callChatCompletions(creds, baseBody);
    }

    await this.prisma.aiTrace.create({
      data: {
        userId,
        purpose,
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        response: content,
        model: creds.model,
      },
    });

    return this.extractJsonObject(content) as T;
  }

  async chatText(purpose: string, systemPrompt: string, userPrompt: string, userId?: string) {
    const creds = await this.resolveCredentials(userId);
    const content = await this.callChatCompletions(creds, {
      model: creds.model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    await this.prisma.aiTrace.create({
      data: {
        userId,
        purpose,
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        response: content,
        model: creds.model,
      },
    });
    return content;
  }
}
