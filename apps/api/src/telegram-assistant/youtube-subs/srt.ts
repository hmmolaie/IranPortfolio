import { SubtitleGenerationError } from './errors';
import { SubtitleSegment } from './subtitle';

export function formatSrtTimestamp(seconds: number): string {
  const msTotal = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(msTotal / 3_600_000);
  const m = Math.floor((msTotal % 3_600_000) / 60_000);
  const s = Math.floor((msTotal % 60_000) / 1000);
  const ms = msTotal % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

export function buildPersianSrt(segments: SubtitleSegment[]): string {
  const lines: string[] = [];
  let n = 0;
  for (const seg of segments) {
    const text = (seg.translatedText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) throw new SubtitleGenerationError();
    if (!(seg.start < seg.end)) throw new SubtitleGenerationError();
    n += 1;
    lines.push(
      String(n),
      `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}`,
      `\u202B${text}\u202C`,
      '',
    );
  }
  if (!n) throw new SubtitleGenerationError();
  return `\uFEFF${lines.join('\n')}`;
}
