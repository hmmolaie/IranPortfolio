/** «۱ ساعت و ۵ دقیقه»؛ زیر یک دقیقه «کمتر از یک دقیقه» */
export function formatDurationFa(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return 'کمتر از یک دقیقه';
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const fa = (n: number) => n.toLocaleString('fa-IR');
  const parts: string[] = [];
  if (days) parts.push(`${fa(days)} روز`);
  if (hours) parts.push(`${fa(hours)} ساعت`);
  if (minutes && !days) parts.push(`${fa(minutes)} دقیقه`);
  return parts.join(' و ');
}

/** خلاصهٔ دستگاه و مرورگر از User-Agent */
export function describeDevice(ua?: string | null): string {
  if (!ua) return '—';
  const os = /iPhone|iPad/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'اندروید'
      : /Windows/i.test(ua)
        ? 'ویندوز'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'مک'
          : /Linux/i.test(ua)
            ? 'لینوکس'
            : '';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : '';
  return [os, browser].filter(Boolean).join(' · ') || 'نامشخص';
}

export type SessionUser = { id: string; email: string; name?: string | null; role?: string };

export function sessionUserLabel(u: SessionUser): string {
  return u.name?.trim() ? `${u.name} (${u.email})` : u.email;
}
