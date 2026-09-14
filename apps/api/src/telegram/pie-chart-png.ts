import { deflateSync } from 'zlib';

export const PIE_COLORS_RGB: Array<[number, number, number]> = [
  [11, 31, 58],
  [22, 50, 92],
  [168, 137, 62],
  [196, 163, 90],
  [74, 103, 65],
  [107, 143, 113],
  [139, 69, 19],
  [92, 107, 192],
  [0, 137, 123],
  [216, 67, 21],
];

const FONT_5X7: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  '%': [0b11001, 0b11010, 0b00100, 0b01000, 0b10110, 0b00110, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
};

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePngRgb(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPx(rgb: Buffer, w: number, x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 3;
  if (i < 0 || i + 2 >= rgb.length) return;
  rgb[i] = r;
  rgb[i + 1] = g;
  rgb[i + 2] = b;
}

function fillRect(
  rgb: Buffer,
  w: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  r: number,
  g: number,
  b: number,
) {
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) setPx(rgb, w, x, y, r, g, b);
  }
}

function drawChar(
  rgb: Buffer,
  w: number,
  x: number,
  y: number,
  ch: string,
  scale: number,
  r: number,
  g: number,
  b: number,
) {
  const rows = FONT_5X7[ch] ?? FONT_5X7[' '];
  for (let row = 0; row < 7; row++) {
    const bits = rows[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        fillRect(rgb, w, x + col * scale, y + row * scale, scale, scale, r, g, b);
      }
    }
  }
}

function drawText(
  rgb: Buffer,
  w: number,
  x: number,
  y: number,
  text: string,
  scale: number,
  r: number,
  g: number,
  b: number,
) {
  let cx = x;
  for (const ch of text) {
    drawChar(rgb, w, cx, y, ch, scale, r, g, b);
    cx += 6 * scale;
  }
}

export function renderPortfolioPiePng(slices: Array<{ pct: number }>): Buffer {
  const W = 900;
  const H = 520;
  const rgb = Buffer.alloc(W * H * 3, 0);
  fillRect(rgb, W, 0, 0, W, H, 247, 245, 241);

  const cleaned = slices.filter((s) => s.pct > 0.05);
  const total = cleaned.reduce((s, x) => s + x.pct, 0) || 1;
  const cx = 250;
  const cy = 270;
  const radius = 175;

  const ranges: Array<{ start: number; end: number; color: [number, number, number] }> = [];
  let cursor = 0;
  cleaned.forEach((slice, idx) => {
    const sweep = (slice.pct / total) * Math.PI * 2;
    ranges.push({
      start: cursor,
      end: cursor + sweep,
      color: PIE_COLORS_RGB[idx % PIE_COLORS_RGB.length],
    });
    cursor += sweep;
  });

  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      let a = Math.atan2(dx, -dy);
      if (a < 0) a += Math.PI * 2;
      const hit = ranges.find((rg) => a >= rg.start && a < rg.end) ?? ranges[ranges.length - 1];
      const [r, g, b] = hit?.color ?? [11, 31, 58];
      setPx(rgb, W, x, y, r, g, b);
    }
  }

  fillRect(rgb, W, cx - 58, cy - 58, 116, 116, 247, 245, 241);

  let ly = 70;
  cleaned.slice(0, 12).forEach((slice, idx) => {
    const [r, g, b] = PIE_COLORS_RGB[idx % PIE_COLORS_RGB.length];
    fillRect(rgb, W, 500, ly, 22, 22, r, g, b);
    const pct = `${(Math.round(slice.pct * 10) / 10).toFixed(1)}%`;
    drawText(rgb, W, 536, ly + 2, `#${idx + 1}  ${pct}`, 2, 11, 31, 58);
    ly += 34;
  });

  return encodePngRgb(W, H, rgb);
}
