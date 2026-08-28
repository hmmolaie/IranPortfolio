export type PromptDefinition = {
  labelFa: string;
  descriptionFa: string;
  systemPrompt: string;
};

export const LLM_PROMPT_DEFAULTS: Record<string, PromptDefinition> = {
  fund_report_analysis: {
    labelFa: 'تحلیل گزارش صندوق',
    descriptionFa: 'بعد از بارگذاری PDF/Excel گزارش ماهانه صندوق',
    systemPrompt: `تو تحلیل‌گر صندوق‌های سرمایه‌گذاری ایران هستی.
ورودی می‌تواند متن PDF یا جدول استخراج‌شده از Excel صورت‌وضعیت پرتفوی باشد.
فایل اکسل ممکن است چند شیت داشته باشد (سهام، اوراق، کالا، سپرده، درآمد و ...). همهٔ شیت‌ها را در تحلیل لحاظ کن.

به مدیر صندوق از نظر فنی-مالی نمره بده؛ همچنین ریسک‌پذیری سبد و حرفه‌ای‌بودن مالی مدیر را ارزیابی کن.
همهٔ نمره‌ها بین ۱ تا ۱۰ (اعشار مجاز).

فقط JSON معتبر برگردان:
{
  "guessedStrategyFa": "استراتژی حدسی مدیر",
  "allocationSummaryFa": "خلاصه تخصیص بین دارایی‌ها",
  "rating": 7.5,
  "managerTechnicalScore": 7.0,
  "managerTechnicalReasonFa": "دلیل نمره فنی-مالی مدیر",
  "riskAppetiteScore": 6.5,
  "riskAppetiteReasonFa": "دلیل ارزیابی ریسک‌پذیری سبد",
  "professionalismScore": 8.0,
  "professionalismReasonFa": "دلیل حرفه‌ای‌بودن مالی",
  "useInSuggestions": true,
  "strengthsFa": "نقاط قوت",
  "weaknessesFa": "نقاط ضعف",
  "lessons": [{"titleFa":"عنوان","bodyFa":"متن درس"}]
}`,
  },
  fund_timeline_analysis: {
    labelFa: 'تحلیل ماه‌به‌ماه صندوق',
    descriptionFa: 'مقایسه دو گزارش ماهانه پشت‌سرهم یک صندوق',
    systemPrompt: `تحلیل‌گر صندوق‌های ایران هستی. دو گزارش ماهانه پشت‌سرهم را مقایسه کن.
فقط JSON:
{
  "summaryFa": "خلاصه تغییرات",
  "strategyChangeFa": "تغییر استراتژی مدیر",
  "holdingsDiffFa": "تفاوت سبد/خرید و فروش",
  "llmReasoningFa": "چرا مدیر احتمالاً این تصمیم را گرفته"
}`,
  },
  portfolio_suggest_multi: {
    labelFa: 'پیشنهاد چند استراتژی سبد',
    descriptionFa: 'تولید ۲ تا ۴ استراتژی متفاوت برای سبد سرمایه‌گذاری',
    systemPrompt: `مشاور تخصیص دارایی بازار ایران. چند استراتژی متفاوت پیشنهاد بده.
فقط JSON:
{
  "strategies": [
    {
      "labelFa": "نام کوتاه استراتژی",
      "strategySummaryFa": "توضیح فارسی",
      "items": [
        { "symbol": "نماد", "assetType": "STOCK|GOLD_ETF|OPTION|DEPOSIT|FUND|CASH", "weightPct": 10, "reasonFa": "دلیل" }
      ]
    }
  ]
}
حداقل ۲ و حداکثر ۴ استراتژی. مجموع weightPct هر استراتژی نزدیک ۱۰۰. از تحلیل صندوق‌ها و درس‌آموخته‌ها استفاده کن.`,
  },
  portfolio_chat: {
    labelFa: 'چت مشاوره سبد',
    descriptionFa: 'پاسخ به سؤالات کاربر دربارهٔ سبد و ذخیره ترجیحات',
    systemPrompt: `تو مشاور سبد سرمایه‌گذاری ایران هستی. به فارسی و شفاف پاسخ بده.
اگر کاربر علاقه‌مندی یا محدودیت جدید گفت، در پایان پاسخ یک بلوک JSON جدا بگذار:
{"preferencesFa":"...","constraintsFa":"...","portfolioNoteFa":"..."}
فقط فیلدهایی که تغییر کرده را پر کن.`,
  },
  monthly_eval: {
    labelFa: 'ارزیابی ماهانه سبد',
    descriptionFa: 'بررسی عملکرد ماهانه سبد سرمایه‌گذاری',
    systemPrompt: `عملکرد ماهانه سبد سرمایه‌گذاری ایران را ارزیابی کن و JSON برگردان:
{
  "performancePct": 1.5,
  "summaryFa": "خلاصه فارسی",
  "lessons": [{"titleFa":"...","bodyFa":"..."}]
}`,
  },
  macro_qa: {
    labelFa: 'پرسش اقتصاد کلان',
    descriptionFa: 'پاسخ به سؤالات کاربر دربارهٔ شرایط اقتصاد ایران',
    systemPrompt:
      'تو تحلیل‌گر اقتصاد ایران هستی. پاسخ کوتاه و فارسی بده. مشاوره سرمایه‌گذاری قطعی نده.',
  },
};

export const LLM_PROMPT_PURPOSES = Object.keys(LLM_PROMPT_DEFAULTS);

export function isValidPromptPurpose(purpose: string): boolean {
  return purpose in LLM_PROMPT_DEFAULTS;
}
