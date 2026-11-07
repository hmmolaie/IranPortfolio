import { AsyncLocalStorage } from 'async_hooks';

/** بخش‌هایی که با تمام شدن سهمیه، برای خود کاربر بسته می‌شوند */
/** پیشنهاد، آنالیز، ارزیابی ماهانه و بازچینش سبد */
export const PORTFOLIO_AI_PURPOSES = new Set([
  'portfolio_suggest_multi',
  'portfolio_analyze',
  'portfolio_hedge',
  'monthly_eval',
]);

export const QUOTA_PURPOSES = new Set([
  'portfolio_suggest_multi',
  'portfolio_analyze',
  'portfolio_hedge',
  'portfolio_chat',
  'monthly_eval',
  'market_tehran_chat',
  'market_symbol_qa',
  'macro_qa',
  'telegram_assistant_qa',
  'telegram_assistant_page',
  'telegram_assistant_pdf',
  'telegram_assistant_youtube',
  'telegram_assistant_youtube_subs',
  'telegram_assistant_transcription',
  'telegram_assistant_tts',
]);

const SECTION_LABELS: Record<string, string> = {
  fund_report_analysis: 'تحلیل صندوق',
  fund_timeline_analysis: 'تحلیل ماه‌به‌ماه صندوق',
  portfolio_suggest_multi: 'پیشنهاد سبد',
  portfolio_stock_screen: 'غربال روزانهٔ سهام',
  portfolio_hedge: 'پوشش ریسک',
  portfolio_analyze: 'آنالیز سبد',
  portfolio_chat: 'چت سبد',
  monthly_eval: 'ارزیابی ماهانه سبد',
  iran_economy_pdf_lessons: 'درس از PDF',
  macro_qa: 'پرسش اقتصاد ایران',
  market_symbol_qa: 'پرسش نماد',
  market_tehran_chat: 'چت بازار تهران',
  economic_news_refresh: 'اخبار شبکه اجتماعی',
  economic_opportunity_refresh: 'فرصت شبکه اجتماعی',
  world_macro_news: 'اخبار کلان جهان',
  world_market_signals: 'سیگنال اقتصاد دنیا',
  telegram_assistant_qa: 'دستیار تلگرام',
  telegram_assistant_page: 'دستیار تلگرام — صفحه',
  telegram_assistant_pdf: 'دستیار تلگرام — PDF',
  telegram_assistant_youtube: 'دستیار تلگرام — یوتیوب',
  telegram_assistant_youtube_subs: 'زیرنویس یوتیوب',
  telegram_assistant_transcription: 'دستیار تلگرام — رونویسی صدا',
  telegram_assistant_tts: 'دستیار تلگرام — فایل صوتی',
  telegram_digest_voice: 'متن اخبار تلگرام',
  tts: 'گفتار',
  transcription: 'رونویسی صدا',
  llm_test: 'تست اتصال مدل',
  personal_digest: 'خبرنامهٔ شخصی تلگرام',
};

/** کارهایی که خود سرور بدون درخواست یک کاربر انجام می‌دهد. در سوابق به‌جای نام کاربر «سیستم» می‌آید. */
export const SYSTEM_HISTORY_PURPOSES = new Set([
  'economic_news_refresh',
  'economic_opportunity_refresh',
  'world_macro_news',
  'world_market_signals',
  'world_x_signals',
  'fund_report_analysis',
  'fund_timeline_analysis',
  'telegram_digest_voice',
  'tts',
  'portfolio_stock_screen',
  'personal_digest',
]);

export function sectionKey(purpose: string): string {
  return purpose.trim() || 'other';
}

export function sectionLabel(purpose: string): string {
  return SECTION_LABELS[purpose] ?? purpose;
}

export function sectionOptions(): { section: string; labelFa: string }[] {
  return Object.entries(SECTION_LABELS).map(([section, labelFa]) => ({ section, labelFa }));
}

export type AiUsageHit = {
  purpose: string;
  sectionFa: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costRial: number;
  estimated: boolean;
};

export const aiUsageStore = new AsyncLocalStorage<{ hits: AiUsageHit[] }>();
