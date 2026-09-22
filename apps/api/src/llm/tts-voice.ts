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

export function isGeminiSpeechModel(model: string): boolean {
  return /gemini/i.test(model);
}

/** اگر صدای درخواستی با خانوادهٔ مدل جور نباشد، پیش‌فرض زنانهٔ همان خانواده برمی‌گردد. */
export function speechVoiceForModel(model: string, requested?: string | null): string {
  const voice = (requested ?? '').trim().toLowerCase();
  if (isGeminiSpeechModel(model)) {
    return GEMINI_FEMALE_VOICES.has(voice) ? voice : DEFAULT_GEMINI_FEMALE_VOICE;
  }
  return OPENAI_FEMALE_VOICES.has(voice) ? voice : DEFAULT_OPENAI_FEMALE_VOICE;
}
