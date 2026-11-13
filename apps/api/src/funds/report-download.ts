import * as path from 'path';
import { fetchPublicUrl } from '../common/safe-url';

/** سقف حجم فایل گزارش دانلودی */
const MAX_REPORT_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const REPORT_LINK_RE = /\.(pdf|xlsx|xls)(\?|#|$)/i;

export type DownloadedReport = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  url: string;
};

function fileNameFrom(res: Response, url: URL): string {
  const disposition = res.headers.get('content-disposition') ?? '';
  const star = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  const raw = star ?? plain;
  if (raw) {
    try {
      return path.basename(decodeURIComponent(raw.trim().replace(/^"|"$/g, '')));
    } catch {
      return path.basename(raw.trim());
    }
  }
  try {
    return path.basename(decodeURIComponent(url.pathname)) || 'report';
  } catch {
    return path.basename(url.pathname) || 'report';
  }
}

async function readLimited(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_REPORT_BYTES) throw new Error('حجم فایل گزارش بیش از ۴۰ مگابایت است');
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPORT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('حجم فایل گزارش بیش از ۴۰ مگابایت است');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function get(url: string): Promise<{ res: Response; buffer: Buffer; url: URL }> {
  let res: Response;
  try {
    res = await fetchPublicUrl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Sabadyar/1.0)',
        Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/html;q=0.5, */*;q=0.3',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError') throw new Error('دانلود فایل گزارش در ۹۰ ثانیه تمام نشد');
    throw new Error(`دانلود فایل گزارش ناموفق بود: ${err.message}`);
  }
  if (!res.ok) throw new Error(`سایت گزارش پاسخ ${res.status} داد`);
  const buffer = await readLimited(res);
  return { res, buffer, url: new URL(res.url || url) };
}

function looksLikeHtml(res: Response, buffer: Buffer): boolean {
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type.includes('text/html') || type.includes('xhtml')) return true;
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

/** اولین پیوند PDF یا Excel داخل صفحهٔ HTML */
function findReportLink(html: string, base: URL): string | null {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  for (const href of hrefs) {
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (REPORT_LINK_RE.test(abs.pathname + abs.search)) return abs.toString();
  }
  return null;
}

/**
 * فایل گزارش را از نشانی کاربر دانلود می‌کند. اگر نشانی صفحهٔ HTML باشد، اولین پیوند PDF یا Excel همان صفحه دانلود می‌شود.
 * فقط نشانی اینترنت عمومی پذیرفته می‌شود (هر تغییر مسیر دوباره بررسی می‌شود).
 */
export async function downloadFundReport(rawUrl: string): Promise<DownloadedReport> {
  let first = await get(rawUrl);
  if (looksLikeHtml(first.res, first.buffer)) {
    const link = findReportLink(first.buffer.toString('utf8'), first.url);
    if (!link) throw new Error('نشانی، صفحهٔ وب است و پیوند PDF یا Excel در آن پیدا نشد؛ نشانی مستقیم فایل را بدهید');
    first = await get(link);
    if (looksLikeHtml(first.res, first.buffer)) {
      throw new Error('پیوند گزارش به‌جای فایل، صفحهٔ وب برگرداند');
    }
  }
  if (!first.buffer.length) throw new Error('فایل دانلودشده خالی است');
  return {
    buffer: first.buffer,
    originalname: fileNameFrom(first.res, first.url),
    mimetype: (first.res.headers.get('content-type') ?? '').split(';')[0].trim(),
    url: first.url.toString(),
  };
}
