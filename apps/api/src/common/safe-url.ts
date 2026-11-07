import { lookup } from 'dns/promises';
import { isIP } from 'net';

/** نشانی‌ای که کاربر داده فقط اگر به اینترنت عمومی برسد؛ نه شبکهٔ داخلی داکر، localhost یا متادیتای ابر. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('نشانی نامعتبر است');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('فقط نشانی http و https پذیرفته می‌شود');
  if (url.username || url.password) throw new Error('نشانی با نام کاربری پذیرفته نمی‌شود');
  if (url.port && !['80', '443', '8080', '8443'].includes(url.port)) throw new Error('درگاه این نشانی مجاز نیست');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error('نشانی داخلی مجاز نیست');
  }
  // نام بدون نقطه (مثل api یا db) نام سرویس داخلی داکر است.
  if (!isIP(host) && !host.includes('.')) throw new Error('نشانی داخلی مجاز نیست');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((row) => row.address);
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address))) {
    throw new Error('نشانی داخلی مجاز نیست');
  }
  return url;
}

/**
 * fetch با بررسی همهٔ تغییر مسیرها. هر پرش دوباره بررسی می‌شود تا صفحهٔ عمومی کاربر را به شبکهٔ داخلی نفرستد.
 */
export async function fetchPublicUrl(raw: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    current = new URL(location, url).toString();
  }
  throw new Error('تغییر مسیر بیش از حد');
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === '::' ||
      ip === '::1' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) ||
      ip.startsWith('ff') ||
      ip.startsWith('64:ff9b:')
    );
  }
  return true;
}
