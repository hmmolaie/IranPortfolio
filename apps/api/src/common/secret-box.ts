import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { previousEncryptionKeys } from './app-secrets';

const derivedKeys = new Map<string, Buffer>();

function deriveKey(rawKey: string): Buffer {
  if (!rawKey) throw new Error('کلید رمزنگاری خالی است');
  let key = derivedKeys.get(rawKey);
  if (!key) {
    key = scryptSync(rawKey, 'sabadyar-salt', 32);
    derivedKeys.set(rawKey, key);
  }
  return key;
}

export function encryptSecret(rawKey: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(rawKey), iv);
  const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** اول با کلید فعلی، بعد با کلیدهای قبلی (چرخش کلید) رمزگشایی می‌کند. */
export function decryptSecret(rawKey: string, payload: string): string {
  const candidates = [rawKey, ...previousEncryptionKeys().filter((key) => key !== rawKey)];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return decryptWith(candidate, payload);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('رمزگشایی ناموفق بود');
}

function decryptWith(rawKey: string, payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(rawKey), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
