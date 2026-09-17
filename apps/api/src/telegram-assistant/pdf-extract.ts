// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages?: number }>;

export type ExtractedPdf = {
  text: string;
  pageCount: number;
  images: Buffer[];
};

function extractEmbeddedJpegs(buf: Buffer, max = 10): Buffer[] {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length - 4 && out.length < max) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const end = buf.indexOf(Buffer.from([0xff, 0xd9]), i + 3);
      if (end > i) {
        const slice = buf.subarray(i, end + 2);
        if (slice.length > 2_000 && slice.length < 4_000_000) out.push(Buffer.from(slice));
        i = end + 2;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

export async function extractPdfContent(buf: Buffer): Promise<ExtractedPdf> {
  const parsed = await pdfParse(buf);
  const text = (parsed.text ?? '').replace(/\u0000/g, '').trim();
  return {
    text: text.slice(0, 70_000),
    pageCount: parsed.numpages ?? 0,
    images: extractEmbeddedJpegs(buf),
  };
}
