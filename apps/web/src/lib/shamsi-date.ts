/** سال و ماه شمسی فعلی به وقت تهران */
export function getCurrentShamsiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '1404');
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '1');

  return { year, month };
}
