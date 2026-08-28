import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as typeof import('xlsx');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

/** سقف متن ارسالی به LLM */
const MAX_LLM_CHARS = 60_000;
/** حداقل سهم هر شیت در متن LLM */
const MIN_SHEET_LLM_CHARS = 700;
/** حداکثر ردیف ذخیره‌شده در دیتابیس برای هر شیت */
const MAX_STORED_ROWS_PER_SHEET = 200;
/** حداکثر طول compactText داخلی هر شیت */
const MAX_COMPACT_PER_SHEET = 18_000;

export type SheetCategory =
  | 'stocks'
  | 'commodities'
  | 'bonds'
  | 'deposits'
  | 'funds'
  | 'income'
  | 'summary'
  | 'cover'
  | 'other';

export type ExtractedSheetRow = {
  label: string;
  values: string[];
  line: string;
};

export type ExtractedSheetData = {
  name: string;
  category: SheetCategory;
  priority: number;
  rowCount: number;
  sectionTitles: string[];
  headers: string[];
  rows: ExtractedSheetRow[];
  compactText: string;
};

export type ExcelExtractionResult = {
  sheetCount: number;
  sheetNames: string[];
  sheets: ExtractedSheetData[];
  textForLlm: string;
};

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
  return row.filter((c) => cellStr(c)).length === 0;
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

function sheetCategory(name: string): SheetCategory {
  const n = name.trim();
  if (/^\d+$/.test(n) || /روکش/.test(n)) return 'cover';
  if (/خلاصه|وضعیت/.test(n)) return 'summary';
  if (/سهام/.test(n)) return 'stocks';
  if (/کالا|شمش/.test(n)) return 'commodities';
  if (/اوراق/.test(n) && !/تعدیل|درآمد|سود/.test(n)) return 'bonds';
  if (/سپرده/.test(n) && !/درآمد|سود/.test(n)) return 'deposits';
  if (/صندوق/.test(n) && !/درآمد|سود/.test(n)) return 'funds';
  if (/درآمد|سود/.test(n)) return 'income';
  return 'other';
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(' | ');
  return (
    /نام شرکت|شرکت|نام اوراق|سپرده|نام کالا|نماد/.test(cells[0] ?? '') ||
    /تعداد|بهای تمام شده|خالص ارزش|درصد|ارزش روز/.test(joined)
  );
}

function isSectionTitle(cells: string[]): boolean {
  if (!cells.length) return false;
  const first = cells[0];
  return (
    cells.length <= 3 &&
    (/سرمایه‌گذاری|صورت وضعیت|صندوق سرمایه|برای ماه منتهی|جمع/.test(first) ||
      (first.length >= 4 && !/[\d۰-۹]/.test(first) && cells.length === 1))
  );
}

function isDataRow(cells: string[]): boolean {
  if (!cells.length) return false;
  const hasNumber = cells.some((c) => /[\d۰-۹]/.test(c) && c.replace(/[,\s]/g, '').length > 0);
  const nameLike = cells[0].length >= 2 && !/^جمع/.test(cells[0]);
  return nameLike && hasNumber;
}

function parseSheetRows(rows: unknown[][], isHolding: boolean): {
  sectionTitles: string[];
  headers: string[];
  dataRows: ExtractedSheetRow[];
  textLines: string[];
} {
  const sectionTitles: string[] = [];
  const headers: string[] = [];
  const dataRows: ExtractedSheetRow[] = [];
  const textLines: string[] = [];
  let headerSeen = false;

  for (const row of rows) {
    if (isMostlyEmpty(row)) continue;
    const cells = row.map(cellStr);
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;

    if (isSectionTitle(nonEmpty)) {
      sectionTitles.push(nonEmpty[0]);
      textLines.push(nonEmpty[0]);
      continue;
    }

    if (isHeaderRow(nonEmpty)) {
      headerSeen = true;
      if (!headers.length) headers.push(...nonEmpty);
      textLines.push(`[سرفصل] ${nonEmpty.join(' | ')}`);
      continue;
    }

    if (isHolding && (headerSeen || isDataRow(nonEmpty))) {
      const line = nonEmpty.slice(0, 14).join(' | ');
      dataRows.push({
        label: nonEmpty[0],
        values: nonEmpty.slice(1, 14),
        line,
      });
      textLines.push(line);
      continue;
    }

    if (!isHolding) {
      const line = nonEmpty.join(' | ');
      if (line.length > 1) {
        textLines.push(line);
        if (isDataRow(nonEmpty)) {
          dataRows.push({
            label: nonEmpty[0],
            values: nonEmpty.slice(1, 14),
            line,
          });
        }
      }
    } else if (nonEmpty.length <= 4) {
      textLines.push(nonEmpty.join(' | '));
    }
  }

  return { sectionTitles, headers, dataRows, textLines };
}

function extractSingleSheet(name: string, sheet: import('xlsx').WorkSheet): ExtractedSheetData | null {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  }) as unknown[][];

  if (!rows.length) return null;

  const priority = sheetPriority(name);
  const category = sheetCategory(name);
  const isHolding = priority >= 60 || ['stocks', 'commodities', 'bonds', 'deposits', 'funds'].includes(category);

  const { sectionTitles, headers, dataRows, textLines } = parseSheetRows(rows, isHolding);
  if (!textLines.length && !dataRows.length) return null;

  const compactBody = textLines.join('\n').slice(0, MAX_COMPACT_PER_SHEET);
  const compactText = [`### شیت: ${name.trim()} (${category})`, compactBody].join('\n');

  return {
    name: name.trim(),
    category,
    priority,
    rowCount: rows.length,
    sectionTitles: sectionTitles.slice(0, 30),
    headers: headers.slice(0, 20),
    rows: dataRows.slice(0, MAX_STORED_ROWS_PER_SHEET),
    compactText,
  };
}

/** متن LLM را طوری می‌سازد که همهٔ شیت‌ها سهم داشته باشند */
export function buildLlmTextFromSheets(sheets: ExtractedSheetData[]): string {
  if (!sheets.length) return '';

  const intro = `[منبع: فایل اکسل — ${sheets.length} شیت: ${sheets.map((s) => s.name).join('، ')}]`;
  const budget = MAX_LLM_CHARS - intro.length - 50;
  const minTotal = sheets.length * MIN_SHEET_LLM_CHARS;

  if (budget <= minTotal) {
    const perSheet = Math.max(400, Math.floor(budget / sheets.length));
    const parts = [intro];
    for (const s of sheets) {
      parts.push(s.compactText.slice(0, perSheet) + (s.compactText.length > perSheet ? '\n…' : ''));
    }
    return parts.join('\n\n').trim();
  }

  const extra = budget - minTotal;
  const totalPriority = sheets.reduce((sum, s) => sum + s.priority, 0) || sheets.length;

  const parts = [intro];
  for (const s of sheets) {
    const share = MIN_SHEET_LLM_CHARS + Math.floor((extra * s.priority) / totalPriority);
    const chunk =
      s.compactText.length <= share
        ? s.compactText
        : s.compactText.slice(0, share) + '\n… [ادامه در دیتابیس ذخیره شده]';
    parts.push(chunk);
  }

  return parts.join('\n\n').trim();
}

export function extractExcelWorkbook(buffer: Buffer): ExcelExtractionResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: false });

  const sheets: ExtractedSheetData[] = [];
  for (const name of wb.SheetNames) {
    const extracted = extractSingleSheet(name, wb.Sheets[name]);
    if (extracted) sheets.push(extracted);
  }

  sheets.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'fa'));

  return {
    sheetCount: wb.SheetNames.length,
    sheetNames: [...wb.SheetNames],
    sheets,
    textForLlm: buildLlmTextFromSheets(sheets),
  };
}

/** سازگاری با کد قدیمی */
export function extractTextFromExcel(buffer: Buffer): string {
  return extractExcelWorkbook(buffer).textForLlm;
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return (parsed.text || '').slice(0, MAX_LLM_CHARS);
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
  if (file.buffer?.[0] === 0x50 && file.buffer?.[1] === 0x4b) return 'excel';
  if (file.buffer?.subarray(0, 4).toString('utf8') === '%PDF') return 'pdf';
  return 'unknown';
}

export async function extractFundReportText(file: Express.Multer.File): Promise<{
  kind: 'pdf' | 'excel' | 'unknown';
  text: string;
  excel?: ExcelExtractionResult;
}> {
  const kind = detectReportKind(file);
  if (kind === 'excel') {
    const excel = extractExcelWorkbook(file.buffer);
    return { kind, text: excel.textForLlm, excel };
  }
  if (kind === 'pdf') {
    try {
      return { kind, text: await extractTextFromPdf(file.buffer) };
    } catch {
      return { kind, text: '' };
    }
  }
  try {
    const excel = extractExcelWorkbook(file.buffer);
    if (excel.textForLlm.length > 80) return { kind: 'excel', text: excel.textForLlm, excel };
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
