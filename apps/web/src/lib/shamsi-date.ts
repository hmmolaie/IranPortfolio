/** تقویم و منطقهٔ زمانی نمایش تاریخ در کل سایت */
const SHAMSI_LOCALE = 'fa-IR-u-ca-persian';
const SHAMSI_TZ = 'Asia/Tehran';

export type ShamsiDateStyle = 'short' | 'medium' | 'long';

/** سال و ماه شمسی فعلی به وقت تهران */
export function getCurrentShamsiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
    timeZone: SHAMSI_TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1404');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');

  return { year, month };
}

function toDate(input: Date | string | number): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00+03:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateFieldOptions(style: ShamsiDateStyle): Intl.DateTimeFormatOptions {
  if (style === 'short') {
    return { year: 'numeric', month: 'numeric', day: 'numeric' };
  }
  return { year: 'numeric', month: 'long', day: 'numeric' };
}

/** تاریخ شمسی برای نمایش؛ ISO یا کلید YYYY-MM-DD را هم می‌پذیرد */
export function formatShamsiDate(
  input: Date | string | number | null | undefined,
  style: ShamsiDateStyle = 'medium',
): string {
  const d = input == null || input === '' ? null : toDate(input);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(SHAMSI_LOCALE, {
      timeZone: SHAMSI_TZ,
      ...dateFieldOptions(style),
    }).format(d);
  } catch {
    return '—';
  }
}

/** تاریخ و ساعت شمسی به وقت تهران */
export function formatShamsiDateTime(
  input: Date | string | number | null | undefined,
  style: ShamsiDateStyle = 'medium',
): string {
  const d = input == null || input === '' ? null : toDate(input);
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat(SHAMSI_LOCALE, {
      timeZone: SHAMSI_TZ,
      ...dateFieldOptions(style),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return '—';
  }
}
