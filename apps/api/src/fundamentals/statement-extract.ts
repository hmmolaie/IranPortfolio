/**
 * متن صورت مالی برای مدل زبانی.
 * اکسل کدال در واقع HTML با چند جدول است و کتابخانهٔ xlsx هر جدول را یک شیت می‌خواند.
 * ردیف‌هایی که همهٔ عددهایشان صفر است و شیت‌های خالی حذف می‌شوند تا متن کوتاه بماند.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buf: Buffer,
  opts?: { pagerender?: typeof renderStatementPage },
) => Promise<{ text: string; numpages?: number }>;
import { renderStatementPage } from './pdf-layout';

/** سقف متن ارسالی به مدل */
export const STATEMENT_MAX_CHARS = 70_000;
/** سقف هر شیت اکسل تا جدول‌های پهن (مثل تغییرات حقوق مالکانه) کل بودجه را نگیرند */
const MAX_SHEET_CHARS = 7_000;
/** ابتدای PDF (مشخصات شرکت و نظر حسابرس) کامل می‌آید؛ بعد از آن فقط خط‌های عددی و عنوان‌های کوتاه */
const PDF_HEAD_CHARS = 6_000;

export type StatementFileKind = 'pdf' | 'excel';

/** ی و ک عربی، هِ دوچشمی و کاراکترهای کنترلی جهت‌دار یکسان می‌شوند */
export function normalizeFa(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ھ/g, 'ه')
    .replace(/[‎‏‪-‮­]/g, '')
    .replace(/‌+/g, '‌');
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d));
  });
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  return normalizeFa(String(v)).replace(/\s+/g, ' ').trim();
}

/** خانه‌ای که فقط عدد (با جداکننده، پرانتز یا خط تیره) است */
function isNumericCell(c: string): boolean {
  return /^[-()\d۰-۹٠-٩,٬.\s%٪]+$/.test(c) && /[\d۰-۹٠-٩]/.test(c);
}

function isZeroCell(c: string): boolean {
  const n = toLatinDigits(c).replace(/[^\d.]/g, '');
  return n === '' || Number(n) === 0;
}

function sheetLines(rows: unknown[][]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map(cellStr).filter(Boolean);
    if (!cells.length) continue;
    const numbers = cells.filter(isNumericCell);
    // ردیف با عدد ولی همه صفر: اطلاعات ندارد
    if (numbers.length && numbers.every(isZeroCell) && numbers.length === cells.length - 1) continue;
    lines.push(cells.join(' | '));
  }
  return lines;
}

export function looksLikePdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1').startsWith('%PDF');
}

export function looksLikeSpreadsheet(buf: Buffer, name: string): boolean {
  const n = name.toLowerCase();
  if (/\.(xlsx|xls|xlsm|htm|html)$/.test(n)) return true;
  // zip (xlsx) یا OLE (xls قدیمی)
  if (buf[0] === 0x50 && buf[1] === 0x4b) return true;
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return true;
  const head = buf.subarray(0, 600).toString('utf8').toLowerCase();
  return head.includes('<html') || head.includes('<table');
}

export function extractStatementExcel(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, dense: false });
  const parts: string[] = [];
  let total = 0;
  let index = 0;
  for (const name of wb.SheetNames) {
    index += 1;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    }) as unknown[][];
    const lines = sheetLines(rows);
    // جدول یک‌خطی بدون عدد (عنوان خالی یا «دلایل تغییرات») چیزی اضافه نمی‌کند
    if (!lines.length || (lines.length <= 2 && !lines.some((l) => /[\d۰-۹]/.test(l)))) continue;
    let body = lines.join('\n');
    if (body.length > MAX_SHEET_CHARS) body = `${body.slice(0, MAX_SHEET_CHARS)}\n…`;
    const chunk = `### جدول ${index}\n${body}`;
    if (total + chunk.length > STATEMENT_MAX_CHARS) {
      parts.push('… [بقیهٔ جدول‌ها به دلیل طول حذف شد]');
      break;
    }
    parts.push(chunk);
    total += chunk.length + 2;
  }
  return parts.join('\n\n');
}

export async function extractStatementPdf(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer, { pagerender: renderStatementPage });
  const text = normalizeFa(parsed.text || '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const inHead = used < PDF_HEAD_CHARS;
    // بعد از سرآغاز، متن بلند بدون عدد (بیشتر بندهای استاندارد حسابرسی) کنار می‌رود
    const keep = inHead || /\d{2,}|[۰-۹]{2,}/.test(line) || line.length <= 70;
    if (!keep) continue;
    if (used + line.length > STATEMENT_MAX_CHARS) {
      out.push('… [بقیهٔ متن به دلیل طول حذف شد]');
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join('\n');
}

export async function extractStatementText(
  buffer: Buffer,
  fileName: string,
): Promise<{ kind: StatementFileKind; text: string }> {
  if (looksLikePdf(buffer)) {
    return { kind: 'pdf', text: await extractStatementPdf(buffer) };
  }
  if (looksLikeSpreadsheet(buffer, fileName)) {
    return { kind: 'excel', text: extractStatementExcel(buffer) };
  }
  throw new Error('فرمت فایل پشتیبانی نمی‌شود. PDF یا Excel (xlsx/xls) کدال بفرستید.');
}
