const ISOLATED = 0;
const FINAL = 1;
const INITIAL = 2;
const MEDIAL = 3;

const FORMS: Record<string, [string, string, string, string]> = {
  ا: ['ا', 'ﺎ', 'ا', 'ﺎ'],
  آ: ['آ', 'ﺂ', 'آ', 'ﺂ'],
  أ: ['أ', 'ﺄ', 'أ', 'ﺄ'],
  إ: ['إ', 'ﺈ', 'إ', 'ﺈ'],
  ب: ['ب', 'ﺐ', 'ﺑ', 'ﺒ'],
  پ: ['پ', 'ﭗ', 'ﭘ', 'ﭙ'],
  ت: ['ت', 'ﺖ', 'ﺗ', 'ﺘ'],
  ث: ['ث', 'ﺚ', 'ﺛ', 'ﺜ'],
  ج: ['ج', 'ﺞ', 'ﺟ', 'ﺠ'],
  چ: ['چ', 'ﭻ', 'ﭼ', 'ﭽ'],
  ح: ['ح', 'ﺢ', 'ﺣ', 'ﺤ'],
  خ: ['خ', 'ﺦ', 'ﺧ', 'ﺨ'],
  د: ['د', 'ﺪ', 'د', 'ﺪ'],
  ذ: ['ذ', 'ﺬ', 'ذ', 'ﺬ'],
  ر: ['ر', 'ﺮ', 'ر', 'ﺮ'],
  ز: ['ز', 'ﺰ', 'ز', 'ﺰ'],
  ژ: ['ژ', 'ﮋ', 'ژ', 'ﮋ'],
  س: ['س', 'ﺲ', 'ﺳ', 'ﺴ'],
  ش: ['ش', 'ﺶ', 'ﺷ', 'ﺸ'],
  ص: ['ص', 'ﺺ', 'ﺻ', 'ﺼ'],
  ض: ['ض', 'ﺾ', 'ﺿ', 'ﻀ'],
  ط: ['ط', 'ﻂ', 'ﻃ', 'ﻄ'],
  ظ: ['ظ', 'ﻆ', 'ﻇ', 'ﻈ'],
  ع: ['ع', 'ﻊ', 'ﻋ', 'ﻌ'],
  غ: ['غ', 'ﻎ', 'ﻏ', 'ﻐ'],
  ف: ['ف', 'ﻒ', 'ﻓ', 'ﻔ'],
  ق: ['ق', 'ﻖ', 'ﻗ', 'ﻘ'],
  ک: ['ک', 'ﮏ', 'ﮐ', 'ﮑ'],
  ك: ['ك', 'ﻚ', 'ﻛ', 'ﻜ'],
  گ: ['گ', 'ﮓ', 'ﮔ', 'ﮕ'],
  ل: ['ل', 'ﻞ', 'ﻟ', 'ﻠ'],
  م: ['م', 'ﻢ', 'ﻣ', 'ﻤ'],
  ن: ['ن', 'ﻦ', 'ﻧ', 'ﻨ'],
  و: ['و', 'ﻮ', 'و', 'ﻮ'],
  ه: ['ه', 'ﻪ', 'ﻫ', 'ﻬ'],
  ة: ['ة', 'ﺔ', 'ة', 'ﺔ'],
  ی: ['ی', 'ﯽ', 'ﯾ', 'ﯿ'],
  ي: ['ي', 'ﻲ', 'ﻳ', 'ﻴ'],
  ى: ['ى', 'ﻰ', 'ى', 'ﻰ'],
  ئ: ['ئ', 'ﺊ', 'ﺋ', 'ﺌ'],
  ؤ: ['ؤ', 'ﺆ', 'ؤ', 'ﺆ'],
};

const NON_CONNECTING = new Set('ادذرزژوآأإؤةى'.split(''));

function isLetter(ch: string) {
  return Boolean(FORMS[ch]);
}

function connectsAfter(ch: string) {
  return isLetter(ch) && !NON_CONNECTING.has(ch);
}

/** شکل‌دهی حروف فارسی برای رسم راست‌به‌چپ در PDF */
export function reshapePersian(input: string): string {
  const chars = [...input];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const forms = FORMS[ch];
    if (!forms) {
      out.push(ch);
      continue;
    }
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i < chars.length - 1 ? chars[i + 1] : '';
    const joinPrev = isLetter(prev) && connectsAfter(prev);
    const joinNext = isLetter(next);
    let form = ISOLATED;
    if (joinPrev && joinNext) form = MEDIAL;
    else if (joinPrev) form = FINAL;
    else if (joinNext && connectsAfter(ch)) form = INITIAL;
    out.push(forms[form]);
  }
  return out.join('');
}

/** برای رسم با pdf-lib: شکل‌دهی + معکوس کردن خط فارسی */
export function rtlLine(input: string): string {
  const trimmed = input.replace(/\s+$/g, '');
  if (!trimmed) return '';
  const hasFa = /[\u0600-\u06FF]/.test(trimmed);
  if (!hasFa) return trimmed;
  return [...reshapePersian(trimmed)].reverse().join('');
}
