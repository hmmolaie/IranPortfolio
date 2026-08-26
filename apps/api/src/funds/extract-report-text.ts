import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const MAX_CHARS = 45000;

const HOLDING_SHEET_HINTS = [
  'سهام',
  'کالا',
  'شمش',
  'اوراق',
  'سپرده',
  'صندوق',
  'پرتفوی',
  'سرمایه',
];

function cellStr(v: unknown): string {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function isMostlyEmpty(row: unknown[]): boolean {
  const filled = row.filter((c) => cellStr(c)).length;
  return filled === 0;
}

function sheetPriority(name: string): number {
  const n = name.trim();
  if (/^\d+$/.test(n) || /روکش|خلاصه|وضعیت/.test(n)) return 10;
  if (/سهام/.test(n)) return 100;
  if (/کالا|شمش/.test(n)) return 90;
  if (/اوراق/.test(n) && !/تعدیل|درآمد|سود/.test(n)) return 80;
  if (/سپرده/.test(n) && !/درآمد|سود/.test(n)) return 70;
  if (HOLDING_SHEET_HINTS.some((h) => n.includes(h)) && !/درآمد|سود/.test(n)) return 60;
  if (/درآمد|سود/.test(n)) return 20;
  return 30;
}

/** ردیف‌هایی که شبیه هولدینگ/نماد هستند را فشرده می‌کند */
function compactHoldingRows(rows: unknown[][]): string[] {
  const lines: string[] = [];
  let headerSeen = false;

  for (const row of rows) {
    if (isMostlyEmpty(row)) continue;
    const cells = row.map(cellStr).filter(Boolean);
    if (!cells.length) continue;

    const joined = cells.join(' | ');
    if (/نام شرکت|شرکت|نام اوراق|سپرده/.test(cells[0]) || /تعداد|بهای تمام شده|خالص ارزش/.test(joined)) {
      headerSeen = true;
      lines.push(`[سرفصل] ${joined}`);
      continue;
    }

    // عنوان بخش‌ها
    if (/سرمایه‌گذاری|صورت وضعیت|صندوق سرمایه|برای ماه منتهی/.test(cells[0]) && cells.length <= 3) {
      lines.push(cells[0]);
      continue;
    }

    // ردیف داده: نام + چند عدد
    const hasNumber = cells.some((c) => /[\d۰-۹]/.test(c) && c.replace(/[,\s]/g, '').length > 0);
    const nameLike = cells[0].length >= 2 && !/^جمع/.test(cells[0]);
    if (headerSeen || (nameLike && hasNumber)) {
      // حداکثر چند فیلد کلیدی برای فشرده‌سازی
      const slim = cells.slice(0, 14).join(' | ');
      lines.push(slim);
    } else if (cells.length <= 4) {
      lines.push(cells.join(' | '));
    }
  }
  return lines;
}

function sheetToText(name: string, sheet: import('xlsx').WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  }) as unknown[][];

  if (!rows.length) return '';

  const priority = sheetPriority(name);
  const isHolding = priority >= 60;
  const body = isHolding
    ? compactHoldingRows(rows)
    : rows
        .filter((r) => !isMostlyEmpty(r))
        .slice(0, 40)
        .map((r) => r.map(cellStr).filter(Boolean).join(' | '))
        .filter(Boolean);

  if (!body.length) return '';
  return [`### شیت: ${name.trim()}`, ...body].join('\n');
}

export function extractTextFromExcel(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: false });
  const ranked = [...wb.SheetNames]
    .map((name, idx) => ({ name, idx, score: sheetPriority(name) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const parts: string[] = ['[منبع: فایل اکسل صورت‌وضعیت پرتفوی صندوق]'];
  let total = parts[0].length;

  for (const { name } of ranked) {
    const chunk = sheetToText(name, wb.Sheets[name]);
    if (!chunk) continue;
    if (total + chunk.length + 2 > MAX_CHARS) {
      const remain = MAX_CHARS - total - 20;
      if (remain > 200) parts.push(chunk.slice(0, remain) + '\n…');
      break;
    }
    parts.push(chunk);
    total += chunk.length + 2;
  }

  return parts.join('\n\n').trim();
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return (parsed.text || '').slice(0, MAX_CHARS);
}

export function detectReportKind(file: Express.Multer.File): 'pdf' | 'excel' | 'unknown' {
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'application/vnd.ms-excel'
  ) {
    return 'excel';
  }
  // امضای فایل xlsx = zip PK
  if (file.buffer?.[0] === 0x50 && file.buffer?.[1] === 0x4b) return 'excel';
  if (file.buffer?.subarray(0, 4).toString('utf8') === '%PDF') return 'pdf';
  return 'unknown';
}

export async function extractFundReportText(file: Express.Multer.File): Promise<{
  kind: 'pdf' | 'excel' | 'unknown';
  text: string;
}> {
  const kind = detectReportKind(file);
  if (kind === 'excel') {
    return { kind, text: extractTextFromExcel(file.buffer) };
  }
  if (kind === 'pdf') {
    try {
      return { kind, text: await extractTextFromPdf(file.buffer) };
    } catch {
      return { kind, text: '' };
    }
  }
  // تلاش اکسل سپس PDF
  try {
    const text = extractTextFromExcel(file.buffer);
    if (text.length > 80) return { kind: 'excel', text };
  } catch {
    /* ignore */
  }
  try {
    return { kind: 'pdf', text: await extractTextFromPdf(file.buffer) };
  } catch {
    return { kind: 'unknown', text: '' };
  }
}

export function safeUploadFileName(originalName: string): string {
  const base = path.basename(originalName).replace(/[^\w.\u0600-\u06FF\-]+/g, '_');
  return `${Date.now()}-${base || 'report'}`;
}
