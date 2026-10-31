import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type ObservedErrorInput = {
  purpose?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  message: string;
  detail?: string | null;
};

@Injectable()
export class ObservedErrorService {
  private depth = 0;
  private recent: Array<{ at: number; key: string }> = [];

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ObservedErrorInput): Promise<void> {
    if (this.depth > 0) return;
    const message = redactSecrets(input.message).trim().slice(0, 4000);
    if (!message) return;
    const key = message.replace(/\s+/g, ' ').slice(0, 240);
    const now = Date.now();
    this.recent = this.recent.filter((row) => now - row.at < 20_000);
    if (this.recent.some((row) => row.key === key)) return;
    this.recent.push({ at: now, key });
    const detail = redactSecrets(input.detail?.trim() || message).slice(0, 20000);
    this.depth += 1;
    try {
      await this.prisma.llmErrorLog.create({
        data: {
          userId: input.userId ?? null,
          purpose: (input.purpose ?? 'system').slice(0, 120),
          statusCode: input.statusCode ?? null,
          message,
          detail,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('ثبت خطای مشاهده‌شده ناموفق بود', err instanceof Error ? err.message : err);
    } finally {
      this.depth -= 1;
    }
  }
}

function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}
