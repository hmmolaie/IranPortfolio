import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export function encryptSecret(rawKey: string, token: string): string {
  const key = scryptSync(rawKey || '0123456789abcdef0123456789abcdef', 'sabadyar-salt', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(rawKey: string, payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const key = scryptSync(rawKey || '0123456789abcdef0123456789abcdef', 'sabadyar-salt', 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
