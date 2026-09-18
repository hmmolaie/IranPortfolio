import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { rtlLine } from './persian-rtl';
import { loadVazirmatn } from './vazir-font';
import type { PdfPageSize } from './pdf-extract';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('@pdf-lib/fontkit');

const A4: PdfPageSize = { width: 595.28, height: 841.89 };

type DrawLine =
  | { kind: 'h1' | 'h2' | 'p'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'image'; imageIndex: number }
  | { kind: 'pagebreak' };

function isPageBreak(line: string) {
  return /<!--PAGE(?:\s+\d+)?-->/.test(line) || line === '---PAGE---';
}

function parseMarkdown(md: string): DrawLine[] {
  const lines: DrawLine[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      lines.push({ kind: 'p', text: '' });
      continue;
    }
    if (isPageBreak(line)) {
      lines.push({ kind: 'pagebreak' });
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
      const prev = lines[lines.length - 1];
      if (prev && prev.kind === 'table') prev.rows.push(cells);
      else lines.push({ kind: 'table', rows: [cells] });
      continue;
    }
    if (line.startsWith('### ')) lines.push({ kind: 'h2', text: line.slice(4) });
    else if (line.startsWith('## ')) lines.push({ kind: 'h2', text: line.slice(3) });
    else if (line.startsWith('# ')) lines.push({ kind: 'h1', text: line.slice(2) });
    else lines.push({ kind: 'p', text: line.replace(/^[-*]\s+/, '• ') });
  }
  return lines;
}

function wrapByWidth(text: string, size: number, maxW: number, font: PDFFont): string[] {
  if (!text) return [''];
  const measure = (s: string) => font.widthOfTextAtSize(rtlLine(s), size);
  const words = text.split(/\s+/);
  const rows: string[] = [];
  let cur = '';
  const pushHard = (s: string) => {
    let rest = s;
    while (rest && measure(rest) > maxW) {
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(rest.slice(0, mid)) <= maxW) lo = mid;
        else hi = mid - 1;
      }
      const n = Math.max(1, lo);
      rows.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    if (rest) rows.push(rest);
  };
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxW) {
      rows.push(cur);
      cur = '';
      if (measure(w) > maxW) pushHard(w);
      else cur = w;
    } else cur = next;
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

async function embedRaster(doc: PDFDocument, buf: Buffer) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return doc.embedPng(buf);
  return doc.embedJpg(buf);
}

export async function buildRtlPdf(opts: {
  titleFa?: string;
  markdownFa: string;
  images: Buffer[];
  pageSize?: PdfPageSize;
  pageSizes?: PdfPageSize[];
}): Promise<Buffer> {
  const fontBytes = await loadVazirmatn();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as Parameters<PDFDocument['registerFontkit']>[0]);
  const font = await doc.embedFont(fontBytes, { subset: false });

  const sizes = opts.pageSizes?.length ? opts.pageSizes : [opts.pageSize ?? A4];
  let sizeIndex = 0;
  const sizeAt = (i: number) => sizes[Math.min(i, sizes.length - 1)] ?? A4;

  let page: PDFPage;
  let pageW = 0;
  let pageH = 0;
  let margin = 48;
  let y = 0;

  const applySize = (sz: PdfPageSize) => {
    pageW = sz.width;
    pageH = sz.height;
    margin = Math.max(36, Math.min(pageW, pageH) * 0.07);
  };

  const newPage = (sz?: PdfPageSize) => {
    applySize(sz ?? sizeAt(sizeIndex));
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const overflowPage = () => newPage(sizeAt(sizeIndex));

  newPage(sizeAt(0));
  const maxWidth = () => pageW - margin * 2;

  const drawText = (text: string, size: number) => {
    const leading = size * 1.45;
    const rows = wrapByWidth(text, size, maxWidth(), font);
    for (const row of rows) {
      if (y < margin + leading) overflowPage();
      const shaped = rtlLine(row);
      if (!shaped) {
        y -= size * 0.6;
        continue;
      }
      const w = font.widthOfTextAtSize(shaped, size);
      page.drawText(shaped, {
        x: pageW - margin - Math.min(w, maxWidth()),
        y,
        size,
        font,
        color: rgb(0.08, 0.12, 0.2),
      });
      y -= leading;
    }
  };

  const drawTable = (rows: string[][]) => {
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const tableW = maxWidth();
    const colW = tableW / cols;
    const size = Math.max(7, Math.min(10, colW / 8));
    const rowH = size * 1.8;
    for (const row of rows) {
      if (y - rowH < margin) overflowPage();
      y -= rowH;
      for (let c = 0; c < cols; c++) {
        const xLeft = pageW - margin - (c + 1) * colW;
        page.drawRectangle({
          x: xLeft,
          y,
          width: colW,
          height: rowH,
          borderWidth: 0.4,
          borderColor: rgb(0.72, 0.75, 0.8),
          color: rgb(1, 1, 1),
        });
        const cell = row[c] ?? '';
        const shaped = rtlLine(cell);
        if (!shaped) continue;
        const tw = font.widthOfTextAtSize(shaped, size);
        const inner = colW - 8;
        page.drawText(shaped, {
          x: xLeft + colW - 4 - Math.min(tw, inner),
          y: y + (rowH - size) / 2,
          size,
          font,
          color: rgb(0.08, 0.12, 0.2),
        });
      }
    }
    y -= 8;
  };

  const title = (opts.titleFa ?? '').trim();
  if (title) {
    drawText(title, 14);
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.5,
      color: rgb(0.72, 0.58, 0.28),
    });
    y -= 14;
  }

  let started = false;
  for (const item of parseMarkdown(opts.markdownFa)) {
    if (item.kind === 'pagebreak') {
      if (started) {
        sizeIndex += 1;
        newPage(sizeAt(sizeIndex));
      }
      started = true;
      continue;
    }
    started = true;
    if (item.kind === 'image') {
      const img = opts.images[item.imageIndex];
      if (!img) continue;
      try {
        const embedded = await embedRaster(doc, img);
        const w = Math.min(maxWidth(), embedded.width, pageW * 0.72);
        const h = (embedded.height / embedded.width) * w;
        if (y - h < margin) overflowPage();
        y -= h;
        page.drawImage(embedded, { x: pageW - margin - w, y, width: w, height: h });
        y -= 10;
      } catch {
        /* skip broken image */
      }
      continue;
    }
    if (item.kind === 'table') {
      drawTable(item.rows);
      continue;
    }
    if (item.text === '') y -= 8;
    else if (item.kind === 'h1') drawText(item.text, 13);
    else if (item.kind === 'h2') drawText(item.text, 12);
    else drawText(item.text, 11);
  }

  return Buffer.from(await doc.save());
}
