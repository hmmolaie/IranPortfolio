import { normalizeSegments } from './subtitle';
import { SubtitleSegment } from './subtitle';

function clockToSec(h: string, m: string, s: string, ms: string): number {
  const frac = ms.length === 3 ? Number(ms) : Number(ms.padEnd(3, '0').slice(0, 3));
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + frac / 1000;
}

/** VTT یا SRT را به segment زمان‌دار تبدیل می‌کند */
export function parseTimedSubtitles(raw: string): SubtitleSegment[] {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const blocks = text.split(/\n{2,}/);
  const rows: Array<{ start: number; end: number; text: string }> = [];
  const timeRe =
    /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/;
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const m = lines[timeIdx].match(timeRe);
    if (!m) continue;
    const start = clockToSec(m[1] || '0', m[2], m[3], m[4]);
    const end = clockToSec(m[5] || '0', m[6], m[7], m[8]);
    const body = lines
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (body) rows.push({ start, end, text: body });
  }
  return normalizeSegments(rows);
}
