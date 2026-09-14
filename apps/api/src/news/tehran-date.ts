/** تاریخ امروز به وقت تهران — YYYY-MM-DD */
export function tehranDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);
}

export function tehranTimeParts(d = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

/** ساعت فعلی تهران (۰–۲۳) */
export function tehranHour(d = new Date()): number {
  return tehranTimeParts(d).hour;
}

/** تاریخ شمسی برای نمایش */
export function tehranDateFa(d = new Date()): string {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function daysAgoDateKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return tehranDateKey(d);
}
