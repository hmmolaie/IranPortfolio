import * as fs from 'fs/promises';
import * as path from 'path';
import { YouTubeDownloadError, VideoTooLargeError, VideoTooLongError } from './errors';
import { ProcessTimedOut, runProcess } from './spawn';
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
    throw new YouTubeDownloadError();
  }
}

export async function readYoutubeDurationSec(videoId: string, timeoutMs = 60_000): Promise<number | null> {
  const res = await exec(
    ['--no-playlist', '--skip-download', '-J', watchUrl(videoId)],
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
  const res = await exec(
    [
      '--no-playlist',
      '--no-warnings',
      '-f',
      'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
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
  if (res.code !== 0) {
    if (/max-filesize|larger than max/i.test(res.stderr)) throw new VideoTooLargeError();
    throw new YouTubeDownloadError();
  }
  const stat = await fs.stat(dest).catch(() => null);
  if (!stat || stat.size < 10_000) throw new YouTubeDownloadError();
  if (stat.size > maxBytes) throw new VideoTooLargeError();
}

export async function downloadEnglishCaptions(
  videoId: string,
  dir: string,
  timeoutMs = 90_000,
): Promise<SubtitleSegment[]> {
  const outBase = path.join(dir, 'captions');
  try {
    await runProcess(
      bin(),
      [
        '--no-playlist',
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        'en.*,en',
        '--convert-subs',
        'vtt',
        '-o',
        outBase,
        watchUrl(videoId),
      ],
      timeoutMs,
    );
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
