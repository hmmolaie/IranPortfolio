/** صداهای زنانهٔ سازگار با OpenAI Speech */
export const OPENAI_FEMALE_VOICES = new Set(['nova', 'shimmer', 'coral', 'sage']);

/**
 * صداهای زنانهٔ Gemini TTS.
 * نام‌ها همان مقدار مجاز مسیر audio/speech هستند.
 */
export const GEMINI_FEMALE_VOICES = new Set([
  'achernar',
  'aoede',
  'autonoe',
  'callirrhoe',
  'despina',
  'erinome',
  'gacrux',
  'kore',
  'laomedeia',
  'leda',
  'pulcherrima',
  'sulafat',
  'vindemiatrix',
  'zephyr',
]);

export const DEFAULT_OPENAI_FEMALE_VOICE = 'nova';
export const DEFAULT_GEMINI_FEMALE_VOICE = 'aoede';

/** مدل‌های گفتار سازگار با OpenAI که پروکسی‌هایی مثل GapGPT روی audio/speech می‌شناسند */
const OPENAI_SPEECH_MODELS = new Set([
  'tts-1',
  'tts-1-hd',
  'gpt-4o-mini-tts',
  'gpt-4o-mini-tts-2025-12-15',
]);

export function isGeminiSpeechModel(model: string): boolean {
  return /gemini/i.test(model);
}

export function isGapGptBase(baseUrl: string): boolean {
  return /gapgpt\.app/i.test(baseUrl);
}

/**
 * GapGPT مسیر OpenAI را پروکسی می‌کند.
 * مدل Gemini روی audio/speech آنجا پاسخ نمی‌دهد و درخواست تا قطع زمان می‌ماند.
 */
export function speechModelForBase(baseUrl: string, model: string): string {
  const name = model.trim();
  if (!isGapGptBase(baseUrl)) return name || 'gpt-4o-mini-tts';
  if (OPENAI_SPEECH_MODELS.has(name)) return name;
  return 'tts-1';
}

/** tts-1 و tts-1-hd فیلد instructions را ندارند و با آن خطا یا معطلی می‌دهند */
export function speechModelAcceptsInstructions(model: string): boolean {
  return !/^tts-1(-hd)?$/i.test(model.trim());
}

/** متن بلند را برای پروکسی‌هایی که روی یک درخواست طولانی جواب نمی‌دهند کوتاه می‌کند. */
export function splitSpeechInput(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const parts: string[] = [];
  let rest = clean;
  while (rest) {
    if (rest.length <= maxChars) {
      parts.push(rest);
      break;
    }
    const window = rest.slice(0, maxChars);
    const marks = ['؟', '!', '.', '؛', '،'];
    let cut = -1;
    for (const mark of marks) {
      const at = window.lastIndexOf(mark);
      if (at > cut) cut = at;
    }
    if (cut < Math.floor(maxChars * 0.45)) {
      const space = window.lastIndexOf(' ');
      cut = space > 40 ? space : maxChars - 1;
    }
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  return parts.filter(Boolean);
}

export function audioSpeechUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/audio/speech`;
  if (isGapGptBase(trimmed)) return `${trimmed}/v1/audio/speech`;
  return `${trimmed}/audio/speech`;
}

/** اگر صدای درخواستی با خانوادهٔ مدل جور نباشد، پیش‌فرض زنانهٔ همان خانواده برمی‌گردد. */
export function speechVoiceForModel(model: string, requested?: string | null): string {
  const voice = (requested ?? '').trim().toLowerCase();
  if (isGeminiSpeechModel(model)) {
    return GEMINI_FEMALE_VOICES.has(voice) ? voice : DEFAULT_GEMINI_FEMALE_VOICE;
  }
  return OPENAI_FEMALE_VOICES.has(voice) ? voice : DEFAULT_OPENAI_FEMALE_VOICE;
}
