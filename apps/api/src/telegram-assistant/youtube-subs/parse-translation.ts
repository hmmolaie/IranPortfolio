import { SubtitleSegment } from './subtitle';

export function parseTranslationJson(raw: string): Map<number, string> {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return new Map();
  }
  if (!Array.isArray(parsed)) return new Map();
  const out = new Map<number, string>();
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as { id?: unknown; translation?: unknown; text?: unknown; fa?: unknown };
    const id = Number(rec.id);
    const translation = String(rec.translation ?? rec.text ?? rec.fa ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!Number.isInteger(id) || id < 1 || !translation) continue;
    out.set(id, translation);
  }
  return out;
}

export function applyTranslations(segments: SubtitleSegment[], translations: Map<number, string>): SubtitleSegment[] {
  return segments.map((seg) => ({
    ...seg,
    translatedText: translations.get(seg.index) ?? seg.translatedText,
  }));
}
