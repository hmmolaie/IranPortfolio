/** تاریخ امروز به وقت تهران — YYYY-MM-DD */
export function tehranDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d);
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
