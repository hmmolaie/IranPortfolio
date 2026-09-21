export type SubtitleSegment = {
  index: number;
  start: number;
  end: number;
  originalText: string;
  translatedText: string | null;
};

export function normalizeSegments(
  rows: Array<{ start: number; end: number; text: string }>,
): SubtitleSegment[] {
  const cleaned = rows
    .map((row) => ({
      start: Number(row.start),
      end: Number(row.end),
      text: row.text.replace(/\s+/g, ' ').trim(),
    }))
    .filter((row) => row.text && Number.isFinite(row.start) && Number.isFinite(row.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return cleaned.map((row, i) => {
    const start = Math.max(0, row.start);
    const end = row.end > start ? row.end : start + 0.4;
    return {
      index: i + 1,
      start,
      end,
      originalText: row.text,
      translatedText: null,
    };
  });
}
