import * as fs from 'fs/promises';
import { TranscriptionError } from './errors';
import { PermanentHttpError, ProcessTimedOut, usefulProcessLog, withRetry } from './spawn';

/** مدل رونویسی GapGPT؛ همان مقدار راهنمای audio/transcriptions */
export const GAPGPT_TRANSCRIPTION_MODEL = 'whisper-1';

export type TranscriptPiece = { start: number; end: number; text: string };

export function gapGptTranscriptionUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/audio/transcriptions`;
  return `${trimmed}/v1/audio/transcriptions`;
}

function mimeFor(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith('.wav')) return 'audio/wav';
  if (name.endsWith('.mp3')) return 'audio/mpeg';
  if (name.endsWith('.webm')) return 'audio/webm';
  if (name.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/mp4';
}

const TRANSCRIBE_VARIANTS: Array<Record<string, string>> = [
  {
    model: GAPGPT_TRANSCRIPTION_MODEL,
    response_format: 'verbose_json',
    'timestamp_granularities[]': 'segment',
  },
  { model: GAPGPT_TRANSCRIPTION_MODEL, response_format: 'verbose_json' },
  { model: GAPGPT_TRANSCRIPTION_MODEL, response_format: 'json' },
];

export async function transcribeBytes(
  buf: Buffer,
  filename: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 180_000,
  durationSec?: number | null,
): Promise<TranscriptPiece[]> {
  if (!baseUrl.trim() || !apiKey.trim()) {
    throw new TranscriptionError('نشانی یا کلید رونویسی خالی است.');
  }
  if (buf.length < 1000) throw new TranscriptionError('فایل صدا خیلی کوچک است.');
  if (buf.length > 25 * 1024 * 1024) throw new TranscriptionError('فایل صدا از حد ۲۵ مگابایت رونویسی بزرگ‌تر است.');

  const failures: string[] = [];
  for (const fields of TRANSCRIBE_VARIANTS) {
    try {
      const body = await postTranscription(buf, filename, baseUrl, apiKey, timeoutMs, fields);
      return parseTranscriptBody(body, durationSec);
    } catch (e) {
      if (e instanceof ProcessTimedOut) throw new TranscriptionError(e.message);
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(msg);
      if (/HTTP 401|HTTP 403/.test(msg)) break;
    }
  }
  throw new TranscriptionError(usefulProcessLog(failures.join('\n'), 4000));
}

async function postTranscription(
  buf: Buffer,
  filename: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  fields: Record<string, string>,
): Promise<string> {
  return withRetry(async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: mimeFor(filename) }), filename || 'audio.mp3');
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    try {
      const res = await fetch(gapGptTranscriptionUrl(baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        const detail = `HTTP ${res.status} ${usefulProcessLog(text, 1500)}`;
        if (res.status === 429 || res.status >= 500) throw new Error(detail);
        throw new PermanentHttpError(detail);
      }
      return text;
    } catch (e) {
      if (e instanceof PermanentHttpError || e instanceof ProcessTimedOut) throw e;
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ProcessTimedOut();
      throw e;
    }
  });
}

export async function transcribeWithGapGpt(
  audioPath: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 180_000,
  durationSec?: number | null,
): Promise<TranscriptPiece[]> {
  const buf = await fs.readFile(audioPath);
  const filename = audioPath.split(/[/\\]/).pop() || 'audio.mp3';
  return transcribeBytes(buf, filename, baseUrl, apiKey, timeoutMs, durationSec);
}

function parseTranscriptBody(body: string, durationSec?: number | null): TranscriptPiece[] {
  let parsed: { text?: string; segments?: Array<{ start?: number; end?: number; text?: string }> };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new TranscriptionError(`پاسخ رونویسی JSON نبود.\n${usefulProcessLog(body, 1500)}`);
  }
  const segments = (parsed.segments ?? [])
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text ?? '').trim(),
    }))
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  if (segments.length) return segments;
  const plain = String(parsed.text ?? '').trim();
  if (!plain) {
    throw new TranscriptionError(`پاسخ رونویسی متن نداشت.\n${usefulProcessLog(body, 1500)}`);
  }
  return piecesFromText(plain, durationSec);
}

function piecesFromText(text: string, durationSec?: number | null): TranscriptPiece[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 8) chunks.push(words.slice(i, i + 8).join(' '));
  if (!chunks.length) return [];
  const total = durationSec != null && durationSec > 1 ? durationSec : chunks.length * 2.5;
  const slice = total / chunks.length;
  return chunks.map((part, i) => ({
    start: Math.round(i * slice * 100) / 100,
    end: Math.round((i + 1) * slice * 100) / 100,
    text: part,
  }));
}
