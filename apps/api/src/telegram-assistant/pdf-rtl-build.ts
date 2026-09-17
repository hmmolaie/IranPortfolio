import { PDFDocument, rgb } from 'pdf-lib';
import { rtlLine } from './persian-rtl';
import { loadVazirmatn } from './vazir-font';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('@pdf-lib/fontkit');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const LINE_H = 18;

type DrawLine = { kind: 'h1' | 'h2' | 'p' | 'table' | 'image'; text?: string; cells?: string[]; imageIndex?: number };

function parseMarkdown(md: string): DrawLine[] {
  const lines: DrawLine[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      lines.push({ kind: 'p', text: '' });
      continue;
    }
    const img = line.match(/!\[.*?\]\(image-(\d+)\)/i);
    if (img) {
      lines.push({ kind: 'image', imageIndex: Number(img[1]) - 1 });
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      if (/^\|[\s:-|]+\|$/.test(line)) continue;
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      lines.push({ kind: 'table', cells });
      continue;
    }
    if (line.startsWith('### ')) lines.push({ kind: 'h2', text: line.slice(4) });
    else if (line.startsWith('## ')) lines.push({ kind: 'h2', text: line.slice(3) });
    else if (line.startsWith('# ')) lines.push({ kind: 'h1', text: line.slice(2) });
    else lines.push({ kind: 'p', text: line.replace(/^[-*]\s+/, '• ') });
  }
  return lines;
}

function wrapRtl(text: string, maxChars: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      rows.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) rows.push(cur);
  return rows;
}

export async function buildRtlPdf(opts: {
  titleFa: string;
  markdownFa: string;
  images: Buffer[];
}): Promise<Buffer> {
  const fontBytes = await loadVazirmatn();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
  const font = await doc.embedFont(fontBytes, { subset: true });

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxWidth = PAGE_W - MARGIN * 2;

  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawText = (text: string, size: number, maxChars: number) => {
    const rows = wrapRtl(text, maxChars);
    for (const row of rows) {
      if (y < MARGIN + LINE_H) newPage();
      const shaped = rtlLine(row);
      const w = font.widthOfTextAtSize(shaped, size);
      page.drawText(shaped, {
        x: PAGE_W - MARGIN - Math.min(w, maxWidth),
        y,
        size,
        font,
        color: rgb(0.08, 0.12, 0.2),
        maxWidth,
      });
      y -= size + 8;
    }
  };

  drawText(opts.titleFa || 'سند ترجمه‌شده', 16, 42);
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.72, 0.58, 0.28),
  });
  y -= 16;

  for (const item of parseMarkdown(opts.markdownFa)) {
    if (item.kind === 'image' && item.imageIndex != null && opts.images[item.imageIndex]) {
      const img = opts.images[item.imageIndex];
      try {
        const embedded = await doc.embedJpg(img).catch(() => null);
        if (!embedded) continue;
        const w = Math.min(maxWidth, 420);
        const h = (embedded.height / embedded.width) * w;
        if (y - h < MARGIN) newPage();
        y -= h;
        page.drawImage(embedded, { x: PAGE_W - MARGIN - w, y, width: w, height: h });
        y -= 12;
      } catch {
        /* skip */
      }
      continue;
    }
    if (item.kind === 'table' && item.cells?.length) {
      drawText(item.cells.join('  ·  '), 9, 70);
      continue;
    }
    if (item.kind === 'h1') drawText(item.text ?? '', 14, 44);
    else if (item.kind === 'h2') drawText(item.text ?? '', 12, 48);
    else if (item.text === '') y -= 8;
    else drawText(item.text ?? '', 11, 52);
  }

  return Buffer.from(await doc.save());
}
