import { TELEGRAM_BOT_URL } from '@/lib/telegram';

/** لینک عمومی همیشه ربات است، نه حساب @sabadyaar */
export function TelegramBotLink() {
  return (
    <a
      className="inline-block font-mono text-navy-900 underline"
      href={TELEGRAM_BOT_URL}
      target="_blank"
      rel="noreferrer"
      dir="ltr"
    >
      {TELEGRAM_BOT_URL}
    </a>
  );
}
