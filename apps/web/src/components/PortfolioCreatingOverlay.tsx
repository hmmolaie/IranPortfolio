'use client';

import { WaitingOverlay } from './WaitingOverlay';

export function PortfolioCreatingOverlay() {
  return (
    <WaitingOverlay
      title="در حال تشکیل سبد"
      description="سبد با سرمایه و استراتژی انتخابی، بر اساس آخرین درس‌آموخته‌ها، اخبار، دادهٔ بازار و صندوق‌ها در حال تشکیل است. لطفاً صبر کنید."
      steps={[
        'خواندن درس‌آموخته‌ها...',
        'بررسی اخبار اقتصادی...',
        'تحلیل دادهٔ بازار...',
        'مرور صندوق‌ها...',
        'چیدن ترکیب سبد با AI...',
      ]}
    />
  );
}
