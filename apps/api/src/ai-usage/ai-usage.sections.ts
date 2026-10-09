import { AsyncLocalStorage } from 'async_hooks';

/** بخش‌هایی که با تمام شدن سهمیه، برای خود کاربر بسته می‌شوند */
export const QUOTA_PURPOSES = new Set([
  'portfolio_suggest_multi',
  'portfolio_analyze',
  'portfolio_chat',
  'monthly_eval',
  'market_tehran_chat',
  'market_symbol_qa',
  'macro_qa',
]);

const SECTION_LABELS: Record<string, string> = {
  fund_report_analysis: 'تحلیل صندوق',
  fund_timeline_analysis: 'تحلیل ماه‌به‌ماه صندوق',
  portfolio_suggest_multi: 'پیشنهاد سبد',
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
  telegram_digest_voice: 'متن اخبار تلگرام',
  tts: 'گفتار',
  transcription: 'رونویسی صدا',
  llm_test: 'تست اتصال مدل',
};

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
