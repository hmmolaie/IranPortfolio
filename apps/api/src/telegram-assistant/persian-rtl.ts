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

/** لام+الف: [isolated, final] */
const LAM_ALEF: Record<string, [string, string]> = {
  ا: ['ﻻ', 'ﻼ'],
  أ: ['ﻷ', 'ﻸ'],
  إ: ['ﻹ', 'ﻺ'],
  آ: ['ﻵ', 'ﻶ'],
};

const NON_CONNECTING = new Set('ادذرزژوآأإؤةى'.split(''));
const ZWNJ = '\u200c';
const ZWJ = '\u200d';

function isLetter(ch: string) {
  return Boolean(FORMS[ch]);
}

function connectsAfter(ch: string) {
  return isLetter(ch) && !NON_CONNECTING.has(ch);
}

function isJoinMark(ch: string) {
  return ch === ZWNJ || ch === ZWJ;
}

function isHarakat(ch: string) {
  const c = ch.codePointAt(0) ?? 0;
  return c >= 0x064b && c <= 0x065f;
}

function normalizeFa(input: string) {
  return input
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '');
}

function lookBackLetter(chars: string[], i: number): { ch: string; zwj: boolean; zwnj: boolean } {
  let zwj = false;
  let zwnj = false;
  for (let j = i - 1; j >= 0; j--) {
    const ch = chars[j];
    if (ch === ZWJ) {
      zwj = true;
      continue;
    }
    if (ch === ZWNJ) {
      zwnj = true;
      continue;
    }
    if (isHarakat(ch)) continue;
    return { ch, zwj, zwnj };
  }
  return { ch: '', zwj, zwnj };
}

function lookAheadLetter(chars: string[], i: number): { ch: string; zwj: boolean; zwnj: boolean } {
  let zwj = false;
  let zwnj = false;
  for (let j = i + 1; j < chars.length; j++) {
    const ch = chars[j];
    if (ch === ZWJ) {
      zwj = true;
      continue;
    }
    if (ch === ZWNJ) {
      zwnj = true;
      continue;
    }
    if (isHarakat(ch)) continue;
    return { ch, zwj, zwnj };
  }
  return { ch: '', zwj, zwnj };
}

/** شکل‌دهی حروف فارسی برای رسم راست‌به‌چپ در PDF */
export function reshapePersian(input: string): string {
  const chars = [...normalizeFa(input)];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (isJoinMark(ch) || isHarakat(ch)) continue;

    const prev = lookBackLetter(chars, i);
    const next = lookAheadLetter(chars, i);
    const joinPrev = isLetter(prev.ch) && connectsAfter(prev.ch) && !prev.zwnj;
    const joinNextLetter = isLetter(next.ch) && !next.zwnj;

    if (ch === 'ل' && LAM_ALEF[next.ch]) {
      const [iso, fin] = LAM_ALEF[next.ch];
      out.push(joinPrev ? fin : iso);
      let skip = 1;
      for (let j = i + 1; j < chars.length && skip > 0; j++) {
        if (isJoinMark(chars[j]) || isHarakat(chars[j])) continue;
        i = j;
        skip -= 1;
      }
      continue;
    }

    const forms = FORMS[ch];
    if (!forms) {
      out.push(ch);
      continue;
    }
    let form = ISOLATED;
    if (joinPrev && joinNextLetter) form = MEDIAL;
    else if (joinPrev) form = FINAL;
    else if (joinNextLetter && connectsAfter(ch)) form = INITIAL;
    out.push(forms[form]);
  }
  return out.join('');
}

function isRtlChar(ch: string) {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x0590 && c <= 0x08ff) ||
    (c >= 0xfb1d && c <= 0xfdff) ||
    (c >= 0xfe70 && c <= 0xfefc)
  );
}

function isLtrChar(ch: string) {
  const c = ch.codePointAt(0) ?? 0;
  if (/[A-Za-z0-9]/.test(ch)) return true;
  if (c >= 0x06f0 && c <= 0x06f9) return true;
  if (c >= 0x0660 && c <= 0x0669) return true;
  return false;
}

type Run = { rtl: boolean; text: string };

function splitBidiRuns(input: string): Run[] {
  const runs: Run[] = [];
  let cur = '';
  let rtl: boolean | null = null;
  const flush = () => {
    if (!cur) return;
    runs.push({ rtl: Boolean(rtl), text: cur });
    cur = '';
  };
  for (const ch of input) {
    if (isRtlChar(ch) || ch === ZWNJ || ch === ZWJ) {
      if (rtl === false) flush();
      rtl = true;
      cur += ch;
      continue;
    }
    if (isLtrChar(ch)) {
      if (rtl === true) flush();
      rtl = false;
      cur += ch;
      continue;
    }
    cur += ch;
  }
  flush();
  return runs;
}

/**
 * برای رسم با pdf-lib: شکل‌دهی عربی + ترتیب دیداری چپ‌به‌راست.
 * اعداد و لاتین برعکس نمی‌شوند.
 */
export function rtlLine(input: string): string {
  const trimmed = input.replace(/\s+$/g, '');
  if (!trimmed) return '';
  const hasFa = /[\u0600-\u06FF]/.test(trimmed);
  if (!hasFa) return trimmed;
  const runs = splitBidiRuns(trimmed);
  const visual = [...runs].reverse().map((run) => {
    if (!run.rtl) return run.text;
    return [...reshapePersian(run.text)].reverse().join('');
  });
  return visual.join('');
}
