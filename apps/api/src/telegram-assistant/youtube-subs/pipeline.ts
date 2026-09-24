import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  FFmpegError,
  JobTimeoutError,
  TelegramUploadError,
  TranscriptionError,
  TranslationError,
  YouTubeDownloadError,
} from './errors';
import { buildFfmpegArgs } from './ffmpeg-args';
import { transcribeWithGapGpt } from './gapgpt';
import { cleanupJobDir, createJobDir } from './job-dir';
import { applyTranslations, parseTranslationJson } from './parse-translation';
import { chunkSegments } from './chunk';
import { buildPersianSrt } from './srt';
import { normalizeSegments, SubtitleSegment } from './subtitle';
import { ProcessTimedOut, runProcess, usefulProcessLog, withRetry } from './spawn';
import { assertDuration, downloadEnglishCaptions, downloadYoutubeVideo, readYoutubeDurationSec } from './ytdlp';
import { loadVazirmatn } from '../vazir-font';

const TRANSLATE_SYSTEM = `تو مترجم زیرنویس هستی.
متن انگلیسی را به فارسی طبیعی و مناسب زیرنویس ترجمه کن.
هیچ جمله‌ای را حذف یا خلاصه نکن و چیزی اضافه نکن.
نام شخص، شرکت، محصول و فناوری را بی‌دلیل ترجمه نکن.
ترتیب idها را عوض نکن و timestamp نساز.
خروجی فقط JSON آرایه باشد:
[{"id":1,"translation":"..."}]`;

export type TranslateFn = (system: string, user: string) => Promise<string>;

export type PipelineResult = {
  jobId: string;
  finalPath: string;
  cleanup: () => Promise<void>;
};

function numEnv(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ffmpegBin(): string {
  return (process.env.FFMPEG_BIN ?? '').trim() || 'ffmpeg';
}

function jobDeadline(): number {
  return Date.now() + numEnv('JOB_TIMEOUT_SEC', 25 * 60) * 1000;
}

function cap(deadline: number, requestedMs: number): number {
  const left = deadline - Date.now();
  if (left < 8_000) throw new JobTimeoutError();
  return Math.min(requestedMs, left);
}

async function within<T>(
  deadline: number,
  fn: () => Promise<T>,
  onStepTimeout: (detail?: string) => Error,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof JobTimeoutError) throw e;
    if (e instanceof ProcessTimedOut) {
      throw Date.now() >= deadline - 2_000 ? new JobTimeoutError(e.detail) : onStepTimeout(e.detail);
    }
    throw e;
  }
}

async function extractAudio(video: string, dir: string, timeoutMs: number): Promise<string> {
  const mp3 = path.join(dir, 'audio.mp3');
  let mp3Log = '';
  try {
    const mp3Res = await runProcess(
      ffmpegBin(),
      ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', mp3],
      timeoutMs,
    );
    if (mp3Res.code === 0) return mp3;
    mp3Log = usefulProcessLog(`${mp3Res.stderr}\n${mp3Res.stdout}`);
  } catch (e) {
    if (e instanceof ProcessTimedOut) throw e;
    mp3Log = e instanceof Error ? e.message : String(e);
  }
  const m4a = path.join(dir, 'audio.m4a');
  let m4aRes: { code: number; stderr: string; stdout: string };
  try {
    m4aRes = await runProcess(
      ffmpegBin(),
      ['-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '64k', m4a],
      timeoutMs,
    );
  } catch (e) {
    if (e instanceof ProcessTimedOut) throw e;
    throw new TranscriptionError(`${mp3Log}\n${e instanceof Error ? e.message : String(e)}`);
  }
  if (m4aRes.code !== 0) {
    throw new TranscriptionError(usefulProcessLog(`${mp3Log}\n${m4aRes.stderr}\n${m4aRes.stdout}`));
  }
  return m4a;
}

async function translateAll(
  segments: SubtitleSegment[],
  translate: TranslateFn,
  deadline: number,
): Promise<SubtitleSegment[]> {
  let current = segments.map((s) => ({ ...s }));
  const chunks = chunkSegments(current);
  for (const chunk of chunks) {
    if (deadline - Date.now() < 8_000) throw new JobTimeoutError();
    const payload = JSON.stringify(chunk.map((s) => ({ id: s.index, text: s.originalText })));
    let map = new Map<number, string>();
    try {
      const raw = await withRetry(
        () => translate(TRANSLATE_SYSTEM, payload),
        3,
      );
      map = parseTranslationJson(raw);
    } catch (e) {
      throw new TranslationError(e instanceof Error ? e.message : String(e));
    }
    const missing = chunk.filter((s) => !map.get(s.index));
    if (missing.length) {
      try {
        const raw = await translate(
          TRANSLATE_SYSTEM,
          JSON.stringify(missing.map((s) => ({ id: s.index, text: s.originalText }))),
        );
        for (const [id, text] of parseTranslationJson(raw)) map.set(id, text);
      } catch (e) {
        throw new TranslationError(e instanceof Error ? e.message : String(e));
      }
    }
    if (chunk.some((s) => !map.get(s.index))) {
      throw new TranslationError('برخی قطعه‌های زیرنویس ترجمه نشدند.');
    }
    current = applyTranslations(current, map);
  }
  return current;
}

export async function runYoutubeSubtitleJob(opts: {
  videoId: string;
  translate: TranslateFn;
  transcribeBaseUrl: string;
  transcribeApiKey: string;
  onStep: (text: string) => Promise<void>;
  log: (line: string) => void;
}): Promise<PipelineResult> {
  const jobId = randomBytes(6).toString('hex');
  const cleanup = () => cleanupJobDir(jobId);
  const log = (line: string) => opts.log(`[job=${jobId}] ${line}`);
  const deadline = jobDeadline();
  try {
    const dir = await createJobDir(jobId);
    const maxSec = numEnv('MAX_VIDEO_DURATION', 20 * 60);
    const maxMb = numEnv('MAX_VIDEO_SIZE_MB', 48);
    const maxBytes = Math.floor(maxMb * 1024 * 1024);
    log('URL received');
    const duration = await within(
      deadline,
      () => readYoutubeDurationSec(opts.videoId, cap(deadline, 60_000)),
      (detail) => new YouTubeDownloadError(detail),
    );
    log('YouTube metadata fetched');
    assertDuration(duration, maxSec);

    await opts.onStep('⬇️ در حال دریافت ویدئو...');
    const video = path.join(dir, 'source.mp4');
    await within(
      deadline,
      () => downloadYoutubeVideo(opts.videoId, video, maxBytes, cap(deadline, 12 * 60_000)),
      (detail) => new YouTubeDownloadError(detail),
    );
    log('Video downloaded');

    let segments: Awaited<ReturnType<typeof downloadEnglishCaptions>> = [];
    try {
      segments = await downloadEnglishCaptions(opts.videoId, dir, cap(deadline, 90_000));
    } catch (e) {
      if (e instanceof ProcessTimedOut && Date.now() >= deadline - 2_000) throw new JobTimeoutError(e.detail);
      if (!(e instanceof ProcessTimedOut) && !(e instanceof YouTubeDownloadError)) throw e;
      segments = [];
    }
    if (segments.length >= 2) {
      log(`Captions used: ${segments.length} segments`);
      await opts.onStep('🎙️ زیرنویس انگلیسی پیدا شد.');
    } else {
      await opts.onStep('🎙️ در حال تبدیل صدا به متن...');
      const audio = await within(
        deadline,
        () => extractAudio(video, dir, cap(deadline, 8 * 60_000)),
        (detail) => new TranscriptionError(detail),
      );
      log('Audio extracted');
      log('Transcription started');
      const pieces = await within(
        deadline,
        () =>
          transcribeWithGapGpt(
            audio,
            opts.transcribeBaseUrl,
            opts.transcribeApiKey,
            cap(deadline, 180_000),
            duration,
          ),
        (detail) => new TranscriptionError(detail),
      );
      segments = normalizeSegments(pieces);
      log(`Transcription completed: ${segments.length} segments`);
    }
    if (segments.length < 1) throw new TranscriptionError('زیرنویس انگلیسی و رونویسی هر دو خالی بودند.');
    await fs.writeFile(path.join(dir, 'transcript.json'), JSON.stringify(segments), 'utf8');

    await opts.onStep('🌐 در حال ترجمه به فارسی...');
    log('Translation started');
    const translated = await translateAll(segments, opts.translate, deadline);
    log('Translation completed');
    await fs.writeFile(path.join(dir, 'translated.json'), JSON.stringify(translated), 'utf8');

    const srtPath = path.join(dir, 'persian.srt');
    await fs.writeFile(srtPath, buildPersianSrt(translated), 'utf8');
    log('SRT generated');

    await opts.onStep('🎬 در حال ساخت ویدئو...');
    const fontBuf = await loadVazirmatn().catch(async (fontErr: unknown) => {
      const fromEnv = (process.env.SUBTITLE_FONT ?? '').trim();
      const why = fontErr instanceof Error ? fontErr.message : 'فونت فارسی پیدا نشد';
      if (!fromEnv) throw new FFmpegError(why);
      try {
        return await fs.readFile(fromEnv);
      } catch (readErr) {
        const readWhy = readErr instanceof Error ? readErr.message : String(readErr);
        throw new FFmpegError(`${why}\n${readWhy}`);
      }
    });
    const fontsDir = path.join(dir, 'fonts');
    await fs.writeFile(path.join(fontsDir, 'Vazirmatn-Regular.ttf'), fontBuf);
    const finalPath = path.join(dir, 'final.mp4');
    log('FFmpeg started');
    const ff = await within(
      deadline,
      () =>
        runProcess(
          ffmpegBin(),
          buildFfmpegArgs(video, finalPath, {
            fontName: 'Vazirmatn',
            fontSize: numEnv('SUBTITLE_FONT_SIZE', 22),
            marginV: numEnv('SUBTITLE_MARGIN_V', 40),
            outline: numEnv('SUBTITLE_OUTLINE', 2),
            fontsDir,
            srtPath,
          }),
          cap(deadline, 20 * 60_000),
        ).catch((e: unknown) => {
          if (e instanceof ProcessTimedOut) throw e;
          throw new FFmpegError(e instanceof Error ? e.message : String(e));
        }),
      (detail) => new FFmpegError(detail),
    );
    if (ff.code !== 0) throw new FFmpegError(usefulProcessLog(`${ff.stderr}\n${ff.stdout}`));
    const stat = await fs.stat(finalPath);
    const telegramLimit = 49 * 1024 * 1024;
    if (stat.size > telegramLimit) {
      throw new TelegramUploadError('فایل نهایی بزرگ‌تر از حد ارسال ربات تلگرام است.');
    }
    log('FFmpeg completed');
    return { jobId, finalPath, cleanup };
  } catch (e) {
    await cleanup().catch(() => undefined);
    throw e;
  }
}
