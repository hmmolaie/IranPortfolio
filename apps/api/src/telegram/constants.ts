export const DEFAULT_TELEGRAM_BOT_USERNAME = 'sabadyaar_bot';
export const DEFAULT_TELEGRAM_BOT_NAME_FA = 'سبدیار';
export const DEFAULT_TELEGRAM_BOT_URL = `https://t.me/${DEFAULT_TELEGRAM_BOT_USERNAME}`;

/** حساب شخصی تلگرام؛ لینک عمومی ربات نیست */
const PERSONAL_ACCOUNT_USERNAMES = new Set(['sabadyaar']);

export function resolveTelegramBotUsername(stored?: string | null) {
  let username = (stored ?? '').trim().replace(/^@/, '');
  username = username.replace(/^https?:\/\/t\.me\//i, '').replace(/\/+$/, '');
  if (!username || PERSONAL_ACCOUNT_USERNAMES.has(username.toLowerCase())) {
    return DEFAULT_TELEGRAM_BOT_USERNAME;
  }
  return username;
}
