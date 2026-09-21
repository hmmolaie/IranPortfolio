import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkSegments } from './chunk';
import { buildFfmpegArgs, escapeFfmpegFilterPath } from './ffmpeg-args';
import { cleanupJobDir, createJobDir, jobDirFor } from './job-dir';
import { applyTranslations, parseTranslationJson } from './parse-translation';
import { buildPersianSrt, formatSrtTimestamp } from './srt';
import { normalizeSegments } from './subtitle';
import { parseTimedSubtitles } from './timed-text';
import { gapGptTranscriptionUrl } from './gapgpt';
import { extractYoutubeId } from '../youtube';

describe('youtube url', () => {
  it('accepts a watch url and rejects other hosts', () => {
    assert.equal(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractYoutubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  });
});

describe('srt', () => {
  it('formats milliseconds', () => {
    assert.equal(formatSrtTimestamp(4.2), '00:00:04,200');
    assert.equal(formatSrtTimestamp(3661.005), '01:01:01,005');
  });

  it('writes sequential cues from segment times', () => {
    const srt = buildPersianSrt([
      { index: 1, start: 0, end: 4.2, originalText: 'a', translatedText: 'سلام اول' },
      { index: 2, start: 4.2, end: 8.5, originalText: 'b', translatedText: 'سلام دوم' },
    ]);
    assert.match(srt, /1\n00:00:00,000 --> 00:00:04,200\n/);
    assert.match(srt, /2\n00:00:04,200 --> 00:00:08,500\n/);
    assert.match(srt, /سلام اول/);
  });
});

describe('segments', () => {
  it('keeps order and renumbers', () => {
    const rows = normalizeSegments([
      { start: 4.2, end: 8, text: 'second' },
      { start: 0, end: 4, text: 'first' },
    ]);
    assert.deepEqual(
      rows.map((r) => r.index),
      [1, 2],
    );
    assert.equal(rows[0].originalText, 'first');
    assert.equal(rows[1].start, 4.2);
  });
});

describe('translation parse', () => {
  it('reads id and translation only', () => {
    const map = parseTranslationJson('note [{"id":2,"translation":"دوم"},{"id":1,"translation":"اول"}]');
    const applied = applyTranslations(
      [
        { index: 1, start: 0, end: 1, originalText: 'a', translatedText: null },
        { index: 2, start: 1, end: 2, originalText: 'b', translatedText: null },
      ],
      map,
    );
    assert.equal(applied[0].translatedText, 'اول');
    assert.equal(applied[0].start, 0);
    assert.equal(applied[1].translatedText, 'دوم');
  });
});

describe('chunking', () => {
  it('does not split a segment and keeps indexes', () => {
    const segments = normalizeSegments([
      { start: 0, end: 10, text: 'x'.repeat(30) },
      { start: 10, end: 20, text: 'y'.repeat(30) },
      { start: 20, end: 30, text: 'z'.repeat(30) },
    ]);
    const chunks = chunkSegments(segments, { maxChars: 70, maxSpanSec: 1000 });
    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks[0].map((s) => s.index),
      [1, 2],
    );
    assert.equal(chunks[1][0].index, 3);
    assert.equal(chunks.flat().map((s) => s.originalText).join(''), segments.map((s) => s.originalText).join(''));
    const alone = chunkSegments(
      normalizeSegments([{ start: 0, end: 1, text: 'a'.repeat(200) }]),
      { maxChars: 40 },
    );
    assert.equal(alone.length, 1);
    assert.equal(alone[0][0].originalText.length, 200);
  });
});

describe('gapgpt url', () => {
  it('builds the transcription endpoint once', () => {
    assert.equal(
      gapGptTranscriptionUrl('https://api.example.com'),
      'https://api.example.com/v1/audio/transcriptions',
    );
    assert.equal(
      gapGptTranscriptionUrl('https://api.example.com/v1/'),
      'https://api.example.com/v1/audio/transcriptions',
    );
  });
});

describe('timed text', () => {
  it('parses vtt cues in order', () => {
    const segs = parseTimedSubtitles(`WEBVTT

00:00:00.000 --> 00:00:04.200
Hello there

00:00:04.200 --> 00:00:08.500
Second line
`);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].start, 0);
    assert.equal(segs[1].originalText, 'Second line');
  });
});

describe('ffmpeg args', () => {
  it('is an argument list without a shell string', () => {
    const args = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', {
      fontName: 'Vazirmatn',
      fontSize: 22,
      marginV: 40,
      outline: 2,
      fontsDir: '/tmp/jobs/abc/fonts',
      srtPath: '/tmp/jobs/abc/persian.srt',
    });
    assert.equal(args[0], '-y');
    assert.ok(args.includes('/tmp/in.mp4'));
    assert.equal(args.at(-1), '/tmp/out.mp4');
    assert.equal(typeof args[args.indexOf('-vf') + 1], 'string');
    assert.equal(escapeFfmpegFilterPath('C:\\a:b'), 'C\\:/a\\:b');
    assert.ok(!args.some((arg) => arg.includes('&&') || arg.startsWith('sh')));
  });
});

describe('job directory', () => {
  it('creates and removes a job folder', async () => {
    const id = 'ab12cd34';
    const dir = await createJobDir(id);
    assert.equal(dir, jobDirFor(id));
    await cleanupJobDir(id);
    assert.throws(() => jobDirFor('../etc'));
  });
});
