/** دامنه‌های عمومی همین سایت. مبدأ درخواست اگر یکی از این‌ها باشد همان دامنه می‌ماند. */
export const PUBLIC_SITE_HOSTS = ['sabad-yar.ir', 'piiip.ir', 'piiip.ai'] as const;

export function publicSiteOrigins(): string[] {
  const out: string[] = [];
  for (const host of PUBLIC_SITE_HOSTS) {
    out.push(`https://${host}`, `http://${host}`, `https://www.${host}`, `http://www.${host}`);
  }
  return out;
}
