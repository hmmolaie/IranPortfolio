/** سقف متن گفتار تا حدود دو دقیقه با سرعت خبرخوانی فارسی */
export const DIGEST_VOICE_MAX_CHARS = 1700;

export type DigestVoiceItem = {
  titleFa: string;
  summaryFa?: string | null;
  marketImpactFa?: string | null;
  participateHowFa?: string | null;
  deadlineFa?: string | null;
};

export function trimSpokenScript(text: string, maxChars = DIGEST_VOICE_MAX_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  const window = t.slice(0, maxChars);
  const marks = ['؟', '!', '.', '؛'];
  let cut = -1;
  for (const m of marks) {
    const i = window.lastIndexOf(m);
    if (i > cut) cut = i;
  }
  if (cut < Math.floor(maxChars * 0.55)) {
    const space = window.lastIndexOf(' ');
    cut = space > 80 ? space - 1 : maxChars - 1;
  }
  return `${window.slice(0, cut + 1).trim()} پایان گزارش.`;
}

export function fallbackDigestVoiceScript(opts: {
  dateLabel: string;
  summaryFa?: string | null;
  macros: DigestVoiceItem[];
  opportunities: DigestVoiceItem[];
}): string {
  const lines: string[] = [`سلام. گزارش ${opts.dateLabel}.`];

  if (opts.summaryFa?.trim() || opts.macros.length) {
    lines.push('بازار این‌گونه شد.');
    if (opts.summaryFa?.trim()) lines.push(opts.summaryFa.trim());
    opts.macros.slice(0, 7).forEach((item, idx) => {
      const n = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم'][idx] ?? String(idx + 1);
      const body = (item.marketImpactFa || item.summaryFa || '').trim();
      lines.push(body ? `خبر ${n}: ${item.titleFa}. ${body}` : `خبر ${n}: ${item.titleFa}.`);
    });
  } else {
    lines.push('خبر اثرگذاری بر اقتصاد ایران دیده نشد.');
  }

  if (opts.opportunities.length) {
    lines.push('فرصت‌های سرمایه‌گذاری که دیده شد این‌ها بودند.');
    opts.opportunities.slice(0, 3).forEach((item, idx) => {
      const n = ['اول', 'دوم', 'سوم'][idx] ?? String(idx + 1);
      const extra = [item.participateHowFa, item.deadlineFa ? `مهلت ${item.deadlineFa}` : '']
        .map((s) => s?.trim())
        .filter(Boolean)
        .join('. ');
      lines.push(extra ? `فرصت ${n}: ${item.titleFa}. ${extra}` : `فرصت ${n}: ${item.titleFa}.`);
    });
  } else {
    lines.push('فرصت سرمایه‌گذاری دیده نشد.');
  }

  lines.push('این گزارش مشاورهٔ قطعی سرمایه‌گذاری نیست.');
  return trimSpokenScript(lines.join(' '));
}
