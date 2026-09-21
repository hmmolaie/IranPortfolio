import * as fs from 'fs/promises';
import { TranscriptionError } from './errors';
import { PermanentHttpError, ProcessTimedOut, withRetry } from './spawn';

/** مدل رونویسی ثابت است و از محیط خوانده نمی‌شود */
export const GAPGPT_TRANSCRIPTION_MODEL = 'gapgpt/whisper-1';

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

export async function transcribeBytes(
  buf: Buffer,
  filename: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 180_000,
): Promise<TranscriptPiece[]> {
  if (!baseUrl.trim() || !apiKey.trim()) throw new TranscriptionError();
  if (buf.length < 1000) throw new TranscriptionError();
  if (buf.length > 25 * 1024 * 1024) throw new TranscriptionError();

  const body = await withRetry(async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type: mimeFor(filename) }), filename || 'audio.m4a');
    form.append('model', GAPGPT_TRANSCRIPTION_MODEL);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    try {
      const res = await fetch(gapGptTranscriptionUrl(baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) throw new Error(`stt ${res.status}`);
        throw new PermanentHttpError(`stt ${res.status}`);
      }
      return text;
    } catch (e) {
      if (e instanceof PermanentHttpError || e instanceof ProcessTimedOut) throw e;
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ProcessTimedOut();
      throw e;
    }
  });

  return parseVerboseJson(body);
}

export async function transcribeWithGapGpt(
  audioPath: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs = 180_000,
): Promise<TranscriptPiece[]> {
  const buf = await fs.readFile(audioPath);
  return transcribeBytes(buf, 'audio.m4a', baseUrl, apiKey, timeoutMs);
}

function parseVerboseJson(body: string): TranscriptPiece[] {
  let parsed: { segments?: Array<{ start?: number; end?: number; text?: string }> };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new TranscriptionError();
  }
  const segments = (parsed.segments ?? [])
    .map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text ?? '').trim(),
    }))
    .filter((s) => s.text && Number.isFinite(s.start) && Number.isFinite(s.end));
  if (!segments.length) throw new TranscriptionError();
  return segments;
}
