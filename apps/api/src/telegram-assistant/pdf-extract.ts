import { PDFDocument } from 'pdf-lib';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buf: Buffer,
  opts?: { pagerender?: (pageData: PdfJsPage) => Promise<string> },
) => Promise<{ text: string; numpages?: number }>;

type PdfJsPage = {
  getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>;
};

export type PdfPageSize = { width: number; height: number };

export type ExtractedPdf = {
  text: string;
  pageCount: number;
  pages: string[];
  pageSizes: PdfPageSize[];
  images: Buffer[];
};

function extractEmbeddedImages(buf: Buffer, max = 12): Buffer[] {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length - 8 && out.length < max) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const end = buf.indexOf(Buffer.from([0xff, 0xd9]), i + 3);
      if (end > i) {
        const slice = buf.subarray(i, end + 2);
        if (slice.length > 2_000 && slice.length < 4_000_000) out.push(Buffer.from(slice));
        i = end + 2;
        continue;
      }
    }
    if (buf[i] === 0x89 && buf[i + 1] === 0x50 && buf[i + 2] === 0x4e && buf[i + 3] === 0x47) {
      const end = buf.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), i + 8);
      if (end > i) {
        const slice = buf.subarray(i, end + 8);
        if (slice.length > 2_000 && slice.length < 4_000_000) out.push(Buffer.from(slice));
        i = end + 8;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

async function readPageSizes(buf: Buffer): Promise<PdfPageSize[]> {
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    return src.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    });
  } catch {
    return [];
  }
}

function linesFromItems(items: Array<{ str?: string; transform?: number[] }>): string {
  const rows: Array<{ y: number; x: number; str: string }> = [];
  for (const item of items) {
    const str = item.str ?? '';
    if (!str) continue;
    const t = item.transform ?? [];
    rows.push({ x: t[4] ?? 0, y: t[5] ?? 0, str });
  }
  rows.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let curY: number | null = null;
  let cur = '';
  for (const r of rows) {
    if (curY != null && Math.abs(curY - r.y) > 3) {
      lines.push(cur.trimEnd());
      cur = r.str;
      curY = r.y;
    } else {
      cur += (cur && !cur.endsWith(' ') && !r.str.startsWith(' ') ? ' ' : '') + r.str;
      if (curY == null) curY = r.y;
    }
  }
  if (cur) lines.push(cur.trimEnd());
  return lines.join('\n').trim();
}

export async function extractPdfContent(buf: Buffer): Promise<ExtractedPdf> {
  const pageSizes = await readPageSizes(buf);
  const pages: string[] = [];

  let parsed: { text: string; numpages?: number };
  try {
    parsed = await pdfParse(buf, {
      pagerender: (pageData) =>
        pageData.getTextContent().then((textContent) => {
          const pageText = linesFromItems(textContent.items ?? []);
          pages.push(pageText);
          return `${pageText}\n`;
        }),
    });
  } catch {
    parsed = await pdfParse(buf);
  }

  const fallback = (parsed.text ?? '').replace(/\u0000/g, '').trim();
  if (!pages.length && fallback) pages.push(fallback);

  const marked = pages
    .map((p, i) => `<!--PAGE ${i + 1}-->\n${p}`)
    .join('\n\n')
    .slice(0, 70_000);

  return {
    text: marked || fallback.slice(0, 70_000),
    pageCount: pages.length || parsed.numpages || 0,
    pages,
    pageSizes,
    images: extractEmbeddedImages(buf),
  };
}
