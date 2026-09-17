import * as fs from 'fs';
import * as path from 'path';

/** Vazirmatn OFL — فقط یک فایل Regular، نه کل مخزن فونت */
const FILENAME = 'Vazirmatn-Regular.ttf';
const MIN_BYTES = 10_000;
const MAX_BYTES = 2_000_000;

function candidates(): string[] {
  return [
    path.join(__dirname, 'fonts', FILENAME),
    path.join(process.cwd(), 'src', 'telegram-assistant', 'fonts', FILENAME),
    path.join(process.cwd(), 'telegram-assistant', 'fonts', FILENAME),
  ];
}

export async function loadVazirmatn(): Promise<Buffer> {
  for (const file of candidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const size = fs.statSync(file).size;
      if (size < MIN_BYTES || size > MAX_BYTES) continue;
      return fs.readFileSync(file);
    } catch {
      /* next */
    }
  }
  throw new Error('فونت فارسی Vazirmatn در بستهٔ API پیدا نشد');
}
