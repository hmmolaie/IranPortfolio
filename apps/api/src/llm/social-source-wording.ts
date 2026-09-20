/** برچسب مجاز برای اشاره به محل انتشار اخبار در متن کاربر. */
export const SOCIAL_NETWORK_LABEL_FA = 'شبکه اجتماعی';

/** به مدل بگو نام شبکه (X / توییتر) را در هیچ متن خروجی نگذارد. */
export const SOCIAL_NETWORK_OUTPUT_RULE = `قانون منبع در خروجی: در هیچ متن فارسی — از جمله titleFa، summaryFa، analysisSummaryFa، marketImpactFa، sourceNoteFa، reasonFa، strategySummaryFa و هر توضیح دیگر — نام شبکه را ننویس: X، Twitter، توییتر، x.com، شبکهٔ X. اگر لازم است به محل انتشار اشاره کنی فقط بنویس «${SOCIAL_NETWORK_LABEL_FA}».`;

export const NEWS_LLM_PURPOSES = new Set([
  'economic_news_refresh',
  'economic_opportunity_refresh',
  'world_x_signals',
  'portfolio_suggest_multi',
  'portfolio_analyze',
]);

export function appendSocialNetworkOutputRule(systemPrompt: string): string {
  const base = systemPrompt.trim();
  if (base.includes(`فقط بنویس «${SOCIAL_NETWORK_LABEL_FA}»`)) return base;
  return `${base}\n\n${SOCIAL_NETWORK_OUTPUT_RULE}`;
}

export function replaceSocialNetworkBrandFa(text: string): string {
  if (!text) return text;
  return text
    .replace(/شبکهٔ?\s*اجتماعی\s*X/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/شبکهٔ?\s*X(\s*\(\s*توییتر\s*\))?/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/فضای\s*X/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/کف\s*X/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/جستجوی\s*(زندهٔ?\s*)?X/gi, `جستجوی ${SOCIAL_NETWORK_LABEL_FA}`)
    .replace(/حساب‌های معتبر\s*X/g, `حساب‌های معتبر ${SOCIAL_NETWORK_LABEL_FA}`)
    .replace(/از\s*X(?=[\s،,.؛:]|$)/g, `از ${SOCIAL_NETWORK_LABEL_FA}`)
    .replace(/در\s*X(?=[\s،,.؛:]|$)/g, `در ${SOCIAL_NETWORK_LABEL_FA}`)
    .replace(/\bX\s*\(\s*Twitter\s*\)/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/\bTwitter\b/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/توییتر/g, SOCIAL_NETWORK_LABEL_FA)
    .replace(/\bx\.com\b/gi, SOCIAL_NETWORK_LABEL_FA)
    .replace(/(^|[\s،,.؛:«»"])X(?=[\s،,.؛:»"]|$)/g, `$1${SOCIAL_NETWORK_LABEL_FA}`);
}

export function redactSocialNetworkBrandInFaFields<T>(value: T): T {
  if (typeof value === 'string') {
    return replaceSocialNetworkBrandFa(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSocialNetworkBrandInFaFields(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const looksFa =
        /Fa$/i.test(key) ||
        key === 'xSourceHintFa' ||
        key === 'reason' ||
        key === 'summary';
      out[key] = looksFa ? redactSocialNetworkBrandInFaFields(nested) : nested;
    }
    return out as T;
  }
  return value;
}
