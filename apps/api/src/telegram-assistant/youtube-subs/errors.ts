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
      detail ? `دریافت ویدئو از یوتیوب ناموفق بود. ${detail}` : 'دریافت ویدئو از یوتیوب ناموفق بود.',
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
  constructor() {
    super('حجم ویدئو برای پردازش یا ارسال در تلگرام زیاد است.', 'VideoTooLargeError');
  }
}

export class TranscriptionError extends YoutubeJobError {
  constructor() {
    super('تبدیل صدا به متن ناموفق بود.', 'TranscriptionError');
  }
}

export class TranslationError extends YoutubeJobError {
  constructor() {
    super('ترجمهٔ زیرنویس به فارسی ناموفق بود.', 'TranslationError');
  }
}

export class SubtitleGenerationError extends YoutubeJobError {
  constructor() {
    super('ساخت فایل زیرنویس فارسی ناموفق بود.', 'SubtitleGenerationError');
  }
}

export class FFmpegError extends YoutubeJobError {
  constructor() {
    super('ساخت ویدئو با زیرنویس ناموفق بود.', 'FFmpegError');
  }
}

export class TelegramUploadError extends YoutubeJobError {
  constructor(messageFa = 'ارسال ویدئو در تلگرام ناموفق بود.') {
    super(messageFa, 'TelegramUploadError');
  }
}

export class JobTimeoutError extends YoutubeJobError {
  constructor() {
    super('زمان پردازش این ویدئو تمام شد.', 'JobTimeoutError');
  }
}
