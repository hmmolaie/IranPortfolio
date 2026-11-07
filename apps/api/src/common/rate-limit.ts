import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * آی‌پی واقعی کاربر از X-Forwarded-For. هر پروکسی آی‌پی طرف قبلی را به انتهای فهرست اضافه می‌کند،
 * پس فقط چند مقدار آخر قابل اعتمادند. TRUSTED_PROXY_HOPS تعداد پروکسی‌های جلوی API است:
 * ۱ یعنی فقط nginx، ۲ یعنی CDN و بعد nginx. مقدارهای جلوتر را خود کاربر می‌تواند جعل کند.
 */
export function clientIpFromHeaders(headers: HeaderBag, fallback?: string): string | null {
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '';
  const chain = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 1)) || 1);
  const picked = chain.length ? chain[Math.max(0, chain.length - hops)] : fallback ?? '';
  const ip = picked.replace(/^::ffff:/, '').slice(0, 64);
  return ip || null;
}

export type RateLimitRule = {
  /** نام جدا برای هر مسیر تا شمارنده‌ها قاطی نشوند */
  scope: string;
  limit: number;
  windowMs: number;
  /** ip: بر اساس آی‌پی؛ email: بر اساس فیلد email بدنه (برای حدس رمز روی یک حساب)؛ all: سقف کل همهٔ درخواست‌ها */
  by: 'ip' | 'email' | 'all';
};

const RATE_LIMIT_KEY = 'sabadyar:rate-limit';
const MAX_BUCKETS = 50_000;

type Bucket = { count: number; resetAt: number };

/** شمارندهٔ درون‌حافظه. API یک پروسه است؛ با ری‌استارت صفر می‌شود که برای این کار کافی است. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly buckets = new Map<string, Bucket>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rules = this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, context.getHandler()) ?? [];
    if (!rules.length) return true;
    const req = context.switchToHttp().getRequest<{
      headers: HeaderBag;
      ip?: string;
      socket?: { remoteAddress?: string };
      body?: { email?: unknown };
    }>();
    const now = Date.now();
    const buckets = RateLimitGuard.buckets;
    if (buckets.size > MAX_BUCKETS) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    }
    for (const rule of rules) {
      const subject =
        rule.by === 'all'
          ? '*'
          : rule.by === 'email'
          ? typeof req.body?.email === 'string'
            ? req.body.email.trim().toLowerCase().slice(0, 200)
            : ''
          : clientIpFromHeaders(req.headers, req.ip || req.socket?.remoteAddress) ?? '';
      if (!subject) continue;
      const key = `${rule.scope}:${rule.by}:${subject}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > rule.limit) {
        const minutes = Math.max(1, Math.ceil((bucket.resetAt - now) / 60_000));
        throw new HttpException(
          `تعداد درخواست‌ها بیش از حد است. ${minutes.toLocaleString('fa-IR')} دقیقهٔ دیگر دوباره تلاش کنید.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return true;
  }
}

export function RateLimit(...rules: RateLimitRule[]) {
  return applyDecorators(SetMetadata(RATE_LIMIT_KEY, rules), UseGuards(RateLimitGuard));
}
