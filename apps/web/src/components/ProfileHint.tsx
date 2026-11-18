'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Profile = {
  riskTolerance?: number | null;
  horizonMonths?: number | null;
  liquidityNeed?: string | null;
  maxDrawdownPct?: number | null;
  inflationSensitivity?: string | null;
  fxSensitivity?: string | null;
};

const FIELDS: Array<{ key: keyof Profile; labelFa: string }> = [
  { key: 'liquidityNeed', labelFa: 'نیاز نقدینگی' },
  { key: 'inflationSensitivity', labelFa: 'حساسیت به تورم' },
  { key: 'fxSensitivity', labelFa: 'حساسیت به ارز' },
  { key: 'maxDrawdownPct', labelFa: 'حداکثر افت قابل قبول' },
];

/**
 * اگر فیلدهایی از پروفایل که روی پیشنهاد سبد و نمرهٔ سلامت اثر دارند خالی باشند، یک یادآوری کوتاه.
 * بستن آن فقط در همین مرورگر به خاطر سپرده می‌شود.
 */
export function ProfileHint() {
  const [missing, setMissing] = useState<string[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem('sabadyar_profile_hint_closed') === '1') return;
    } catch {
      /* بدون حافظهٔ مرورگر هم نمایش داده می‌شود */
    }
    api<{ profile?: Profile | null } | null>('/users/me')
      .then((me) => {
        const p = me?.profile ?? null;
        const empty = FIELDS.filter((f) => p?.[f.key] == null || p?.[f.key] === '').map((f) => f.labelFa);
        setMissing(empty);
        setHidden(empty.length === 0);
      })
      .catch(() => undefined);
  }, []);

  if (hidden || !missing.length) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-gold-400/15 px-4 py-3 text-sm leading-7">
      <p>
        {missing.join('، ')} در پروفایل شما خالی است. این‌ها روی پیشنهاد سبد و نمرهٔ سلامت اثر دارند؛ با تکمیل
        آن‌ها در{' '}
        <Link href="/settings" className="font-medium underline">
          تنظیمات
        </Link>{' '}
        پیشنهاد دقیق‌تر می‌شود.
      </p>
      <button
        type="button"
        className="text-xs text-navy-800/60 hover:underline"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('sabadyar_profile_hint_closed', '1');
          } catch {
            /* بدون حافظهٔ مرورگر فقط تا بارگذاری بعد بسته می‌ماند */
          }
        }}
      >
        بستن
      </button>
    </div>
  );
}
