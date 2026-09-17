import * as fs from 'fs';
import * as path from 'path';

const FONT_URL =
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/ttf/Vazirmatn-Regular.ttf';

export async function loadVazirmatn(): Promise<Buffer> {
  const dir = path.join(process.cwd(), 'uploads', 'fonts');
  const file = path.join(dir, 'Vazirmatn-Regular.ttf');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 10_000) {
      return fs.readFileSync(file);
    }
  } catch {
    /* fetch */
  }
  const res = await fetch(FONT_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`دانلود فونت فارسی ناموفق بود (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
  } catch {
    /* cache optional */
  }
  return buf;
}
