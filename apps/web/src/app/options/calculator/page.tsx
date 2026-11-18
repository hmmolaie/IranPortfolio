'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OptionPayoffCalculator } from '@/components/OptionPayoffCalculator';

function FromQuery() {
  const params = useSearchParams();
  return (
    <div className="space-y-4">
      <Link href="/options" className="text-sm text-navy-800/60 hover:underline">
        ← بازگشت به بازار اختیار
      </Link>
      <OptionPayoffCalculator
        initial={{
          symbol: params.get('symbol'),
          underlying: params.get('underlying'),
          side: params.get('side') === 'PUT' ? 'PUT' : 'CALL',
          strike: params.get('strike'),
          premium: params.get('premium'),
          spot: params.get('spot'),
          size: params.get('size'),
        }}
      />
    </div>
  );
}

/** ماشین‌حساب مستقل؛ برای یک قرارداد مشخص همین ابزار در صفحهٔ همان نماد هم هست */
export default function OptionCalculatorPage() {
  return (
    <Suspense fallback={<p className="text-navy-800/60">در حال بارگذاری...</p>}>
      <FromQuery />
    </Suspense>
  );
}
