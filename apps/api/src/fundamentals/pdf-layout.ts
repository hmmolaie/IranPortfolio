/**
 * خواندن جدول‌های صورت مالی از PDF فارسی.
 *
 * pdf.js متن راست‌به‌چپ را با الگوریتم bidi مرتب می‌کند و در عددهای با ارقام فارسی و ویرگول،
 * ترتیب گروه‌های سه‌رقمی گاهی جابه‌جا می‌شود (مثلاً ۱۶۱٬۶۰۸٬۰۴۴ به شکل ۶۰۸٬۰۴۴٬۱۶۱ می‌آید).
 * اینجا هر خط از روی مختصات تکه‌های متن دوباره ساخته می‌شود و برای هر عدد جابه‌جاشده،
 * چینش‌های ممکن با ستون «درصد تغییر» همان ردیف سنجیده می‌شود. عددی که قطعی نشود با «؟» علامت می‌خورد.
 */

type PdfTextItem = { str: string; transform: number[]; width: number; dir?: string };

type Item = { s: string; x: number; y: number; w: number; dir: string };

type Cell =
  | { kind: 'text'; text: string }
  | { kind: 'num'; candidates: number[]; negative: boolean; raw: string }
  | { kind: 'pct'; value: number | null; raw: string };

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function latinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = FA_DIGITS.indexOf(d);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(d));
  });
}

const NUM_RE = /^[\d۰-۹٠-٩][\d۰-۹٠-٩,٬.]*$/;
const PAREN_RE = /^[()]+$/;
/** فاصلهٔ افقی بیشتر از این، دو ستون جدا است */
const CELL_GAP = 9;
/** ردیف‌هایی که y آن‌ها این‌قدر نزدیک است یک خط‌اند */
const LINE_TOLERANCE = 2.5;

function validGrouping(groups: string[]): boolean {
  if (groups.length < 2) return /^\d+$/.test(groups[0] ?? '');
  if (!/^\d{1,3}$/.test(groups[0])) return false;
  if (groups[0].length > 1 && groups[0].startsWith('0')) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/** چینش‌های ممکن یک عدد؛ اولی همان چیزی است که pdf.js داده اگر معتبر باشد */
export function numberCandidates(raw: string, dir: string): number[] {
  const s = latinDigits(raw).replace(/٬/g, ',');
  if (!s.includes(',')) return [Number(s.replace(/[^\d.]/g, ''))];
  const groups = s.split(',').filter((g) => g !== '');
  if (dir !== 'rtl') return [Number(groups.join(''))];
  const orders: string[][] = [groups, [...groups].reverse()];
  for (let k = 1; k < groups.length; k++) orders.push([...groups.slice(k), ...groups.slice(0, k)]);
  const out: number[] = [];
  for (const order of orders) {
    if (!validGrouping(order)) continue;
    const v = Number(order.join(''));
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : [Number(groups.join(''))];
}

function lineItems(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: Item[][] = [];
  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= LINE_TOLERANCE);
    if (line) line.push(item);
    else lines.push([item]);
  }
  // راست‌به‌چپ: برچسب سمت راست، ستون‌ها به ترتیب از راست
  for (const line of lines) line.sort((a, b) => b.x - a.x);
  return lines;
}

function buildCells(line: Item[]): Cell[] {
  const parens = line.filter((i) => PAREN_RE.test(i.s.trim()));
  const cells: Cell[] = [];
  let text: Item[] = [];
  const flushText = () => {
    if (!text.length) return;
    const joined = text
      .map((t) => t.s)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined) cells.push({ kind: 'text', text: joined });
    text = [];
  };
  let prevLeft: number | null = null;
  for (const item of line) {
    const s = item.s.trim();
    if (!s || PAREN_RE.test(s)) continue;
    const gap = prevLeft == null ? 0 : prevLeft - (item.x + item.w);
    prevLeft = item.x;
    if (NUM_RE.test(s)) {
      flushText();
      const negative = parens.some((p) => p.x >= item.x - 6 && p.x <= item.x + item.w + 6);
      const plain = latinDigits(s).replace(/[,٬]/g, '');
      // عدد کوچک بی‌ویرگول در انتهای ردیف معمولاً درصد تغییر است؛ بعداً تعیین می‌شود
      cells.push({ kind: 'num', candidates: numberCandidates(s, item.dir), negative, raw: s });
      void plain;
      continue;
    }
    if (s === '--' || s === '—') {
      flushText();
      cells.push({ kind: 'pct', value: null, raw: s });
      continue;
    }
    if (gap > CELL_GAP) flushText();
    text.push(item);
  }
  flushText();
  // آخرین عدد کوچک بدون ویرگول بعد از دست‌کم دو عدد بزرگ = درصد تغییر
  const nums = cells.filter((c) => c.kind === 'num') as Array<Extract<Cell, { kind: 'num' }>>;
  const last = cells[cells.length - 1];
  if (last?.kind === 'num' && nums.length >= 3 && !last.raw.includes(',') && !last.raw.includes('٬')) {
    const v = last.candidates[0];
    if (Math.abs(v) < 100_000) {
      cells[cells.length - 1] = { kind: 'pct', value: last.negative ? -v : v, raw: last.raw };
    }
  }
  return cells;
}

/** چینش دو عدد اول را با درصد تغییر ردیف انتخاب می‌کند */
function resolveWithPct(a: number[], b: number[], pct: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestErr = Infinity;
  for (const x of a) {
    for (const y of b) {
      if (!y) continue;
      const change = Math.abs((Math.abs(x) / Math.abs(y) - 1) * 100);
      const err = Math.abs(change - Math.abs(pct));
      if (err < bestErr) {
        bestErr = err;
        best = [x, y];
      }
    }
  }
  // درصد کدال گرد شده است؛ بیش از ۱٫۵ واحد اختلاف یعنی قطعی نیست
  return best && bestErr <= 1.5 ? best : null;
}

function formatNum(v: number, negative: boolean, uncertain: boolean): string {
  const s = Math.round(v).toLocaleString('en-US');
  return `${negative ? `(${s})` : s}${uncertain ? '؟' : ''}`;
}

function renderLine(cells: Cell[]): string {
  const nums = cells.filter((c) => c.kind === 'num') as Array<Extract<Cell, { kind: 'num' }>>;
  const pct = cells.find((c) => c.kind === 'pct') as Extract<Cell, { kind: 'pct' }> | undefined;
  const chosen = new Map<Cell, { v: number; sure: boolean }>();
  if (nums.length >= 2 && pct?.value != null && (nums[0].candidates.length > 1 || nums[1].candidates.length > 1)) {
    const pick = resolveWithPct(nums[0].candidates, nums[1].candidates, pct.value);
    if (pick) {
      chosen.set(nums[0], { v: pick[0], sure: true });
      chosen.set(nums[1], { v: pick[1], sure: true });
    }
  }
  return cells
    .map((c) => {
      if (c.kind === 'text') return c.text;
      if (c.kind === 'pct') return c.value == null ? '--' : `${c.value}%`;
      const pick = chosen.get(c);
      if (pick) return formatNum(pick.v, c.negative, false);
      return formatNum(c.candidates[0], c.negative, c.candidates.length > 1);
    })
    .join(' | ');
}

/** همان امضای pagerender در pdf-parse */
export async function renderStatementPage(page: {
  getTextContent: (opts: object) => Promise<{ items: PdfTextItem[] }>;
}): Promise<string> {
  const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const items: Item[] = content.items
    .filter((i) => typeof i.str === 'string' && i.str.length > 0)
    .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, dir: i.dir ?? 'ltr' }));
  return lineItems(items)
    .map((line) => renderLine(buildCells(line)))
    .filter((l) => l.trim())
    .join('\n');
}
