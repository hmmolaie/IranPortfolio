/** نرمال‌سازی موبایل ایران به 09xxxxxxxxx */
export function normalizeIranMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (s.startsWith('0098')) s = s.slice(4);
  else if (s.startsWith('98')) s = s.slice(2);
  if (s.startsWith('9') && s.length === 10) s = `0${s}`;
  if (/^09\d{9}$/.test(s)) return s;
  return null;
}

export function mobilesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeIranMobile(a);
  const nb = normalizeIranMobile(b);
  return Boolean(na && nb && na === nb);
}
