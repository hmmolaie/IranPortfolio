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
