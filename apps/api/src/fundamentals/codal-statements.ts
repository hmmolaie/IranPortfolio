/**
 * جستجوی صورت‌های مالی در کدال با همان فیلتر صفحهٔ ReportList.aspx و دانلود اکسل هر اطلاعیه.
 * بدون دیتابیس و بدون مدل.
 */
import { gregorianToJalali, jalaliToJulianDay } from '../market/option-board';
import { normalizeCodalSymbol } from '../market/codal';

const CODAL_SITE = 'https://www.codal.ir';
/** صفحهٔ ReportList.aspx فهرست را با جاوااسکریپت از همین نشانی می‌گیرد */
const CODAL_SEARCH = 'https://search.codal.ir/api/search/v2/q';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
/** سقف صفحه‌های یک بازه؛ هر صفحهٔ کدال حدود ۲۰ اطلاعیه است */
export const CODAL_MAX_PAGES = 60;
const MAX_EXCEL_BYTES = 40 * 1024 * 1024;

export type JalaliDate = { jy: number; jm: number; jd: number };

export type CodalStatementLetter = {
  tracingNo: number;
  symbol: string;
  companyFa: string;
  titleFa: string;
  /** زمان انتشار با رقم لاتین، مثل 1405/01/25 12:30:00 */
  publishedAtFa: string;
  publishedAt: Date | null;
  /** کلید عددی برای مرتب‌سازی، مثل 140501251230 */
  publishedKey: number;
  excelUrl: string | null;
  pageUrl: string | null;
};

// ---------------------------------------------------------------- تاریخ شمسی

function div(a: number, b: number) {
  return ~~(a / b);
}
function mod(a: number, b: number) {
  return a - ~~(a / b) * b;
}

function julianDayToGregorian(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** رقم فارسی و عربی را لاتین می‌کند */
export function latinDigits(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
}

export function jalaliMonthDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalaliToJulianDay(jy + 1, 1, 1) - jalaliToJulianDay(jy, 12, 1);
}

/** «1405/01/01» یا «۱۴۰۵/۱/۱» ← تاریخ معتبر یا null */
export function parseJalaliDate(raw: string | null | undefined): JalaliDate | null {
  const m = latinDigits(String(raw ?? '')).trim().match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthDays(jy, jm)) return null;
  return { jy, jm, jd };
}

export function formatJalaliDate(d: JalaliDate): string {
  return `${d.jy}/${String(d.jm).padStart(2, '0')}/${String(d.jd).padStart(2, '0')}`;
}

export function jalaliKey(d: JalaliDate): number {
  return d.jy * 10000 + d.jm * 100 + d.jd;
}

export function addJalaliDays(d: JalaliDate, days: number): JalaliDate {
  const g = julianDayToGregorian(jalaliToJulianDay(d.jy, d.jm, d.jd) + days);
  return gregorianToJalali(g.gy, g.gm, g.gd);
}

/** یک ماه بعد منهای یک روز؛ ۱۴۰۵/۰۱/۰۱ ← ۱۴۰۵/۰۱/۳۱ */
export function monthWindowEnd(from: JalaliDate): JalaliDate {
  const jy = from.jm === 12 ? from.jy + 1 : from.jy;
  const jm = from.jm === 12 ? 1 : from.jm + 1;
  const next = { jy, jm, jd: Math.min(from.jd, jalaliMonthDays(jy, jm)) };
  return addJalaliDays(next, -1);
}

export function tehranTodayJalali(now = new Date()): JalaliDate {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(now);
  const [gy, gm, gd] = key.split('-').map(Number);
  return gregorianToJalali(gy, gm, gd);
}

/** «1405/01/25 12:30:00» به وقت تهران ← Date (ایران از ۱۴۰۱ ساعت تابستانی ندارد: UTC+3:30) */
export function jalaliDateTimeToDate(raw: string): Date | null {
  const s = latinDigits(raw).trim();
  const d = parseJalaliDate(s);
  if (!d) return null;
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/);
  const g = julianDayToGregorian(jalaliToJulianDay(d.jy, d.jm, d.jd));
  const hh = t ? Number(t[1]) : 0;
  const mm = t ? Number(t[2]) : 0;
  const ss = t?.[3] ? Number(t[3]) : 0;
  const utc = Date.UTC(g.gy, g.gm - 1, g.gd, hh, mm, ss) - 210 * 60_000;
  return Number.isFinite(utc) ? new Date(utc) : null;
}

/** تاریخ شمسی تهرانِ یک لحظه */
export function jalaliOf(date: Date): JalaliDate {
  return tehranTodayJalali(date);
}

// ---------------------------------------------------------------- کدال

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** فقط نشانی‌های خود codal.ir (از جمله excel.codal.ir) پذیرفته می‌شوند */
export function codalHostUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const url = new URL(s, `${CODAL_SITE}/`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/(^|\.)codal\.ir$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** همان پارامترهای فیلتر صفحهٔ ReportList.aspx که ادمین داده؛ فقط بازهٔ تاریخ و صفحه عوض می‌شود */
function filterParams(fromFa: string, toFa: string, page: number): Array<[string, string]> {
  return [
    ['search', 'true'],
    ['LetterType', '-1'],
    ['FromDate', fromFa],
    ['ToDate', toFa],
    ['AuditorRef', '-1'],
    ['PageNumber', String(page)],
    ['Audited', 'true'],
    ['NotAudited', 'false'],
    ['IsNotAudited', 'false'],
    ['Childs', 'false'],
    ['Mains', 'true'],
    ['Publisher', 'false'],
    ['CompanyState', '0'],
    ['ReportingType', '-1'],
    ['Length', '12'],
    ['Category', '1'],
    ['CompanyType', '-1'],
    ['Consolidatable', 'true'],
    ['NotConsolidatable', 'true'],
  ];
}

/** نشانی صفحهٔ کدال برای نمایش به ادمین */
export function codalStatementListPageUrl(fromFa: string, toFa: string): string {
  const qs = filterParams(fromFa, toFa, 1)
    .map(([k, v]) => (k === 'search' ? k : `${k}=${encodeURIComponent(v)}`))
    .join('&');
  return `${CODAL_SITE}/ReportList.aspx?${qs}`;
}

export type CodalStatementPage = { letters: CodalStatementLetter[]; pageCount: number; total: number | null };

/** یک صفحه از نتیجهٔ جستجوی صورت‌های مالی در بازهٔ تاریخ */
export async function fetchCodalStatementPage(fromFa: string, toFa: string, page: number): Promise<CodalStatementPage> {
  const url = new URL(CODAL_SEARCH);
  for (const [k, v] of filterParams(fromFa, toFa, page)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: `${CODAL_SITE}/` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`کدال پاسخ ${res.status} داد`);
  let json: Record<string, unknown> | null;
  try {
    json = asRecord(await res.json());
  } catch {
    throw new Error('پاسخ جستجوی کدال JSON نبود');
  }
  const rows = Array.isArray(json?.Letters) ? json.Letters : null;
  if (!rows) throw new Error('ساختار پاسخ جستجوی کدال ناشناخته است');

  const letters: CodalStatementLetter[] = [];
  for (const item of rows) {
    const row = asRecord(item);
    if (!row) continue;
    const tracingNo = Number(row.TracingNo);
    const symbol = String(row.Symbol ?? '').replace(/\s+/g, ' ').trim();
    const titleFa = String(row.Title ?? '').replace(/\s+/g, ' ').trim();
    if (!Number.isInteger(tracingNo) || tracingNo <= 0 || !symbol || !titleFa) continue;
    const publishedAtFa = latinDigits(String(row.PublishDateTime ?? row.SentDateTime ?? ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const day = parseJalaliDate(publishedAtFa);
    const time = publishedAtFa.match(/(\d{1,2}):(\d{2})/);
    const publishedKey = day ? jalaliKey(day) * 10000 + (time ? Number(time[1]) * 100 + Number(time[2]) : 0) : 0;
    const hasExcel = row.HasExcel === true || row.HasExcel === 'true';
    letters.push({
      tracingNo,
      symbol,
      companyFa: String(row.CompanyName ?? '').trim().slice(0, 200),
      titleFa: titleFa.slice(0, 500),
      publishedAtFa,
      publishedAt: jalaliDateTimeToDate(publishedAtFa),
      publishedKey,
      excelUrl: hasExcel ? codalHostUrl(String(row.ExcelUrl ?? '')) : null,
      pageUrl: codalHostUrl(String(row.Url ?? '')),
    });
  }
  const pageCount = Math.max(1, Number(json?.Page) || 1);
  const total = Number.isFinite(Number(json?.Total)) ? Number(json?.Total) : null;
  return { letters, pageCount, total };
}

/** فایل اکسل کدال (در واقع HTML چندجدولی) */
export async function downloadCodalExcel(excelUrl: string): Promise<Buffer> {
  const safe = codalHostUrl(excelUrl);
  if (!safe) throw new Error('نشانی اکسل بیرون از codal.ir است');
  const res = await fetch(safe, {
    headers: { 'User-Agent': UA, Accept: '*/*', Referer: `${CODAL_SITE}/` },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`دانلود اکسل پاسخ ${res.status} داد`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_EXCEL_BYTES) throw new Error('فایل اکسل بیش از ۴۰ مگابایت است');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_EXCEL_BYTES) throw new Error('فایل اکسل بیش از ۴۰ مگابایت است');
  if (buffer.length < 200) throw new Error('فایل اکسل خالی است');
  return buffer;
}

export function codalSymbolKey(symbol: string): string {
  return normalizeCodalSymbol(symbol);
}
