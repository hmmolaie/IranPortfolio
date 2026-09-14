import { TELEGRAM_BOT_URL } from '@/lib/telegram';

export function TelegramBotLink({ href }: { href?: string | null }) {
  const url = href?.trim() || TELEGRAM_BOT_URL;
  return (
    <a
      className="inline-block font-mono text-navy-900 underline"
      href={url}
      target="_blank"
      rel="noreferrer"
      dir="ltr"
    >
      {url}
    </a>
  );
}
