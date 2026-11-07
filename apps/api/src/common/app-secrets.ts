/** خواندن کلیدهای محرمانهٔ سرور. در production بدون کلید امن، API بالا نمی‌آید. */

const LEGACY_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
const DEV_JWT_SECRET = 'dev-secret';

/** مقدارهای نمونه که در مخزن یا مستندات آمده‌اند و نباید در production بمانند. */
const KNOWN_WEAK = new Set([
  DEV_JWT_SECRET,
  'change-me-to-a-long-random-string',
  LEGACY_ENCRYPTION_KEY,
  'secret',
  'changeme',
]);

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function envValue(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function jwtSecret(): string {
  const value = envValue('JWT_SECRET');
  if (value) return value;
  if (isProduction()) throw new Error('JWT_SECRET تنظیم نشده است.');
  return DEV_JWT_SECRET;
}

export function encryptionKey(): string {
  const value = envValue('LLM_TOKEN_ENCRYPTION_KEY');
  if (value) return value;
  if (isProduction()) throw new Error('LLM_TOKEN_ENCRYPTION_KEY تنظیم نشده است.');
  return LEGACY_ENCRYPTION_KEY;
}

/**
 * کلیدهای قبلی رمزنگاری، جدا با کاما. برای چرخش کلید: کلید تازه در LLM_TOKEN_ENCRYPTION_KEY
 * و کلید قدیمی در LLM_TOKEN_ENCRYPTION_KEY_PREVIOUS. رمزگشایی با هر دو کار می‌کند و ذخیرهٔ دوباره با کلید تازه است.
 */
export function previousEncryptionKeys(): string[] {
  return envValue('LLM_TOKEN_ENCRYPTION_KEY_PREVIOUS')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/** پیش از بالا آمدن API در production صدا زده می‌شود. */
export function assertProductionSecrets(): void {
  if (!isProduction()) return;
  const problems: string[] = [];
  const jwt = envValue('JWT_SECRET');
  if (!jwt) problems.push('JWT_SECRET خالی است.');
  else if (KNOWN_WEAK.has(jwt) || jwt.length < 32) {
    problems.push('JWT_SECRET مقدار نمونه یا کوتاه‌تر از ۳۲ نویسه است. با کلید نمونه هر کسی می‌تواند توکن مدیر بسازد.');
  }
  const enc = envValue('LLM_TOKEN_ENCRYPTION_KEY');
  if (!enc) problems.push('LLM_TOKEN_ENCRYPTION_KEY خالی است.');
  if (problems.length) {
    throw new Error(`API بدون کلیدهای امن بالا نمی‌آید:\n- ${problems.join('\n- ')}\nکلید تازه: openssl rand -hex 32`);
  }
  if (KNOWN_WEAK.has(enc) || enc.length < 32) {
    // کلید رمزنگاری را نمی‌شود بی‌صدا عوض کرد؛ توکن‌های ذخیره‌شده با همین کلید باز می‌شوند.
    // eslint-disable-next-line no-console
    console.warn(
      'هشدار امنیتی: LLM_TOKEN_ENCRYPTION_KEY مقدار نمونه است. کلید تازه بگذارید، مقدار فعلی را در LLM_TOKEN_ENCRYPTION_KEY_PREVIOUS نگه دارید و توکن‌ها را از تنظیمات ادمین دوباره ذخیره کنید.',
    );
  }
}
