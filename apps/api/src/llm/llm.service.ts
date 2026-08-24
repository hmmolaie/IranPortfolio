import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LlmService {
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
    if (data.baseUrl !== undefined) update.baseUrl = data.baseUrl;
    if (data.model !== undefined) update.model = data.model;
    if (data.usePlatformFallback !== undefined) update.usePlatformFallback = data.usePlatformFallback;
    if (data.apiToken) update.apiTokenEncrypted = this.encryptToken(data.apiToken);

    return this.prisma.llmSetting.upsert({
      where: { userId },
      create: {
        userId,
        baseUrl: data.baseUrl ?? 'https://api.openai.com/v1',
        model: data.model ?? 'gpt-4o-mini',
        apiTokenEncrypted: data.apiToken ? this.encryptToken(data.apiToken) : undefined,
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

  private async resolveCredentials(userId?: string) {
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

  async chatJson<T>(
    purpose: string,
    systemPrompt: string,
    userPrompt: string,
    userId?: string,
  ): Promise<T> {
    const creds = await this.resolveCredentials(userId);
    const body = {
      model: creds.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };

    const res = await fetch(`${creds.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`خطای LLM: ${res.status} ${text}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '{}';

    await this.prisma.aiTrace.create({
      data: {
        userId,
        purpose,
        prompt: `${systemPrompt}\n---\n${userPrompt}`,
        response: content,
        model: creds.model,
      },
    });

    return JSON.parse(content) as T;
  }

  async chatText(purpose: string, systemPrompt: string, userPrompt: string, userId?: string) {
    const creds = await this.resolveCredentials(userId);
    const res = await fetch(`${creds.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: creds.model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`خطای LLM: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    await this.prisma.aiTrace.create({
      data: { userId, purpose, prompt: `${systemPrompt}\n---\n${userPrompt}`, response: content, model: creds.model },
    });
    return content;
  }
}
