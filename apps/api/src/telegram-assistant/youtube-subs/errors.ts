export class YoutubeJobError extends Error {
  constructor(
    messageFa: string,
    readonly code: string,
  ) {
    super(messageFa);
    this.name = code;
  }
}

export class InvalidYouTubeUrlError extends YoutubeJobError {
  constructor() {
    super('فقط لینک یوتیوب پذیرفته می‌شود.', 'InvalidYouTubeUrlError');
  }
}

export class YouTubeDownloadError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail ? `دریافت ویدئو از یوتیوب ناموفق بود.\n${detail}` : 'دریافت ویدئو از یوتیوب ناموفق بود.',
      'YouTubeDownloadError',
    );
  }
}

export class VideoTooLongError extends YoutubeJobError {
  constructor(limitMin: number) {
    super(`مدت ویدئو بیشتر از حد مجاز (${limitMin.toLocaleString('fa-IR')} دقیقه) است.`, 'VideoTooLongError');
  }
}

export class VideoTooLargeError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail
        ? `حجم ویدئو برای پردازش یا ارسال در تلگرام زیاد است.\n${detail}`
        : 'حجم ویدئو برای پردازش یا ارسال در تلگرام زیاد است.',
      'VideoTooLargeError',
    );
  }
}

export class TranscriptionError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail ? `تبدیل صدا به متن ناموفق بود.\n${detail}` : 'تبدیل صدا به متن ناموفق بود.',
      'TranscriptionError',
    );
  }
}

export class TranslationError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail ? `ترجمهٔ زیرنویس به فارسی ناموفق بود.\n${detail}` : 'ترجمهٔ زیرنویس به فارسی ناموفق بود.',
      'TranslationError',
    );
  }
}

export class SubtitleGenerationError extends YoutubeJobError {
  constructor() {
    super('ساخت فایل زیرنویس فارسی ناموفق بود.', 'SubtitleGenerationError');
  }
}

export class FFmpegError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail ? `ساخت ویدئو با زیرنویس ناموفق بود.\n${detail}` : 'ساخت ویدئو با زیرنویس ناموفق بود.',
      'FFmpegError',
    );
  }
}

export class TelegramUploadError extends YoutubeJobError {
  constructor(messageFa = 'ارسال ویدئو در تلگرام ناموفق بود.') {
    super(messageFa, 'TelegramUploadError');
  }
}

export class JobTimeoutError extends YoutubeJobError {
  constructor(detail?: string) {
    super(
      detail ? `زمان پردازش این ویدئو تمام شد.\n${detail}` : 'زمان پردازش این ویدئو تمام شد.',
      'JobTimeoutError',
    );
  }
}

export function describeError(error: unknown): string {
  const chunks: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && chunks.length < 8) {
    seen.add(current);
    if (current instanceof Error) {
      chunks.push(`${current.name}: ${current.message}`.trim());
      current = current.cause;
      continue;
    }
    chunks.push(String(current));
    break;
  }
  return chunks.filter(Boolean).join('\n\n');
}
