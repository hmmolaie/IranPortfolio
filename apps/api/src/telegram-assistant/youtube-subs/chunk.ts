import { SubtitleSegment } from './subtitle';

const DEFAULT_CHARS = 4500;
const DEFAULT_SPAN_SEC = 8 * 60;

/** segmentها نصف نمی‌شوند؛ هر قطعه حدود چند دقیقه یا سقف نویسه است */
export function chunkSegments(
  segments: SubtitleSegment[],
  opts?: { maxChars?: number; maxSpanSec?: number },
): SubtitleSegment[][] {
  const maxChars = opts?.maxChars ?? DEFAULT_CHARS;
  const maxSpan = opts?.maxSpanSec ?? DEFAULT_SPAN_SEC;
  const chunks: SubtitleSegment[][] = [];
  let cur: SubtitleSegment[] = [];
  let chars = 0;
  let spanStart = 0;

  for (const seg of segments) {
    const nextChars = chars + seg.originalText.length;
    const span = cur.length ? seg.end - spanStart : 0;
    if (cur.length && (nextChars > maxChars || span > maxSpan)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    if (!cur.length) spanStart = seg.start;
    cur.push(seg);
    chars += seg.originalText.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
