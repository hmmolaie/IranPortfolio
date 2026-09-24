import * as fs from 'fs/promises';
import * as path from 'path';
import { YouTubeDownloadError, VideoTooLargeError, VideoTooLongError } from './errors';
import { ProcessTimedOut, runProcess, usefulProcessLog } from './spawn';
import { parseTimedSubtitles } from './timed-text';
import { SubtitleSegment } from './subtitle';

function bin(): string {
  return (process.env.YT_DLP_BIN ?? '').trim() || 'yt-dlp';
}

function watchUrl(videoId: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new YouTubeDownloadError();
  return `https://www.youtube.com/watch?v=${videoId}`;
}

async function exec(args: string[], timeoutMs: number) {
  try {
    return await runProcess(bin(), args, timeoutMs);
  } catch (e) {
    if (e instanceof ProcessTimedOut) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return { code: 127, stdout: '', stderr: msg };
  }
}

function youtubeAttemptArgs(client: string | null, withJsRuntime: boolean): string[] {
  const args = ['--no-playlist', '--no-warnings', '--force-overwrites'];
  if (withJsRuntime) args.push('--js-runtimes', 'node');
  if (client) args.push('--extractor-args', `youtube:player_client=${client}`);
  return args;
}

function failureText(stderr: string, stdout: string, code: number): string {
  return usefulProcessLog(`${stderr}\n${stdout}`) || `yt-dlp exit ${code}`;
}

export async function readYoutubeDurationSec(videoId: string, timeoutMs = 60_000): Promise<number | null> {
  const res = await exec(
    [
      ...youtubeAttemptArgs('android,web', true),
      '--skip-download',
      '-J',
      watchUrl(videoId),
    ],
    timeoutMs,
  );
  if (res.code !== 0) return null;
  try {
    const json = JSON.parse(res.stdout) as { duration?: number };
    return Number.isFinite(json.duration) ? Number(json.duration) : null;
  } catch {
    return null;
  }
}

export async function downloadYoutubeVideo(
  videoId: string,
  dest: string,
  maxBytes: number,
  timeoutMs = 12 * 60_000,
): Promise<void> {
  const attempts: Array<{ client: string | null; js: boolean; format: string }> = [
    { client: 'android,web', js: true, format: 'bv*[height<=720]+ba/b[height<=720]/b' },
    { client: 'ios,web', js: false, format: 'bv*[height<=720]+ba/b[height<=720]/b' },
    { client: null, js: false, format: 'b' },
  ];
  let lastErr = '';
  for (const attempt of attempts) {
    const res = await exec(
      [
        ...youtubeAttemptArgs(attempt.client, attempt.js),
        '-f',
        attempt.format,
        '--merge-output-format',
        'mp4',
        '--max-filesize',
        String(maxBytes),
        '-o',
        dest,
        watchUrl(videoId),
      ],
      timeoutMs,
    );
    const detail = failureText(res.stderr, res.stdout, res.code);
    if (/max-filesize|larger than max/i.test(detail)) throw new VideoTooLargeError(detail);
    if (res.code === 0) {
      const stat = await fs.stat(dest).catch(() => null);
      if (stat && stat.size >= 10_000 && stat.size <= maxBytes) return;
      if (stat && stat.size > maxBytes) throw new VideoTooLargeError(`حجم فایل: ${stat.size}`);
      lastErr = detail || 'فایل ویدئو ساخته نشد';
      continue;
    }
    lastErr = detail;
  }
  throw new YouTubeDownloadError(lastErr);
}

export async function downloadEnglishCaptions(
  videoId: string,
  dir: string,
  timeoutMs = 90_000,
): Promise<SubtitleSegment[]> {
  const outBase = path.join(dir, 'captions');
  const captionArgs = [
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs',
    'en.*,en-US,en',
    '--convert-subs',
    'vtt',
    '-o',
    outBase,
    watchUrl(videoId),
  ];
  try {
    const first = await runProcess(bin(), [...youtubeAttemptArgs('android,web', true), ...captionArgs], timeoutMs);
    if (first.code !== 0) {
      await runProcess(bin(), [...youtubeAttemptArgs('web', false), ...captionArgs], timeoutMs);
    }
  } catch (e) {
    if (e instanceof ProcessTimedOut) throw e;
    return [];
  }
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const vtt = names.find((n) => n.startsWith('captions') && n.endsWith('.vtt'));
  if (!vtt) return [];
  const raw = await fs.readFile(path.join(dir, vtt), 'utf8');
  return parseTimedSubtitles(raw);
}

export function assertDuration(durationSec: number | null, maxSec: number) {
  if (durationSec != null && durationSec > maxSec) {
    throw new VideoTooLongError(Math.round(maxSec / 60));
  }
}
