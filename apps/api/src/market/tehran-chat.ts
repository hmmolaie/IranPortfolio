/** نرمال‌سازی حروف عربی/فارسی برای تطبیق نماد */
export function foldFa(s: string): string {
  return s
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ة/g, 'ه')
    .replace(/[\u200c\u200d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'این',
  'آن',
  'که',
  'از',
  'به',
  'در',
  'با',
  'را',
  'تا',
  'یا',
  'هم',
  'هر',
  'برای',
  'آیا',
  'چیست',
  'چطور',
  'چقدر',
  'چرا',
  'کدام',
  'کجا',
  'کی',
  'چه',
  'شده',
  'است',
  'بود',
  'باشد',
  'کرد',
  'کن',
  'بگو',
  'درباره',
  'مورد',
  'سوال',
  'سؤال',
  'لطفا',
  'لطفاً',
  'سلام',
  'قیمت',
  'سهم',
  'سهام',
  'نماد',
  'بورس',
  'فرابورس',
  'بازار',
  'تهران',
  'صندوق',
  'صندوق‌ها',
  'صندوقها',
  'خرید',
  'فروش',
  'خریده',
  'خریده‌اند',
  'دارند',
  'دارد',
  'شاخص',
  'کل',
  'هموزن',
  'هم‌وزن',
  'آخرین',
  'پایانی',
  'حجم',
  'سود',
  'تحلیل',
  'اطلاعات',
  'داده',
  'موجود',
  'گزارش',
  'امروز',
  'دیروز',
  'هفته',
  'ماه',
]);

/** سؤال کلی دربارهٔ بورس تهران (حتی بدون ذکر نماد خاص) */
const MARKET_SCOPE_RE =
  /بورس|فرابورس|بازار\s*سهام|بازار\s*تهران|شاخص(\s*کل|\s*هم)?|نماد|سهام|سهم|صف\s*(خرید|فروش)|حقیقی|حقوقی|عرضه\s*اولیه|کدال|قیمت\s*پایانی|eps|p\s*\/?\s*e|سود\s*(هر\s*)?سهم|کدام\s*صندوق|صندوق.*(خرید|دارا|سهام)|خرید.*صندوق|هم[\s‌-]*وزن/i;

export const MARKET_CHAT_REFUSE_FA =
  'این گفتگو فقط دربارهٔ نمادهای سهام و بازار بورس تهران است.';

export function tokenizeMarketQuestion(question: string): string[] {
  const folded = foldFa(question);
  const parts = folded.split(/[\s,،.؟?!؛:()[\]{}"'«»\/\\|+*=]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const t = foldFa(raw);
    if (t.length < 2 || t.length > 24) continue;
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 12);
}

export function isTehranMarketScoped(question: string, matchedSymbolCount: number): boolean {
  if (matchedSymbolCount > 0) return true;
  return MARKET_SCOPE_RE.test(foldFa(question));
}

export function wantsTotalIndex(question: string): boolean {
  return /شاخص\s*کل/.test(foldFa(question));
}

export function wantsEqualWeightIndex(question: string): boolean {
  const q = foldFa(question);
  return /شاخص\s*هم/.test(q) || /هم[\s‌-]*وزن/.test(q);
}
