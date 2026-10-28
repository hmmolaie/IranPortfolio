'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';

type ValuableOption = {
  id: string;
  symbol: string;
  nameFa: string;
  sideFa: string;
  underlyingSymbol: string;
  underlyingPrice: number;
  strike: number;
  premium: number;
  daysLeft: number;
  contractSize: number | null;
  profitPerUnit: number;
  profitRial: number;
  profitPct: number;
  reasonFa: string;
};

type Payload = {
  disclaimerFa: string;
  items: ValuableOption[];
};

export default function OptionsMarketPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<Payload>('/market/option-value')
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">بازار اختیار معامله</h1>
        <p className="mt-2 text-navy-800/70">
          فقط اختیارهای فعال که سررسیدشان نگذشته و سودشان نسبت به قیمت دارایی پایه قابل توجه است. مرتب‌سازی بر اساس سود قرارداد، از زیاد به کم.
        </p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {data && <p className="text-sm text-navy-800/60">{data.disclaimerFa}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-3 py-3 text-start font-medium">نماد</th>
              <th className="px-3 py-3 text-start font-medium">نوع</th>
              <th className="px-3 py-3 text-start font-medium">دارایی پایه</th>
              <th className="px-3 py-3 text-start font-medium">قیمت پایه</th>
              <th className="px-3 py-3 text-start font-medium">اعمال</th>
              <th className="px-3 py-3 text-start font-medium">قیمت اختیار</th>
              <th className="px-3 py-3 text-start font-medium">روز مانده</th>
              <th className="px-3 py-3 text-start font-medium">سود</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40 hover:bg-gold-400/10"
                onClick={() => router.push(`/market/${row.id}`)}
              >
                <td className="px-3 py-2.5 font-medium">{row.symbol}</td>
                <td className="px-3 py-2.5">{row.sideFa}</td>
                <td className="px-3 py-2.5">{row.underlyingSymbol}</td>
                <td className="px-3 py-2.5">{formatNum(row.underlyingPrice)}</td>
                <td className="px-3 py-2.5">{formatNum(row.strike)}</td>
                <td className="px-3 py-2.5">{formatNum(row.premium)}</td>
                <td className="px-3 py-2.5">{Math.round(row.daysLeft).toLocaleString('fa-IR')}</td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-emerald-700">{formatNum(row.profitRial)}</div>
                  <div className="text-xs text-navy-800/55">
                    {row.profitPct.toLocaleString('fa-IR')}٪ نسبت به قیمت اختیار
                    {row.contractSize != null ? ` · اندازه ${formatNum(row.contractSize)}` : ''}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">
            اختیار ارزشمندی با سود قابل توجه و سررسید باقی‌مانده در دادهٔ امروز نیست.
          </p>
        )}
        {!data && !error && <p className="p-6 text-sm text-navy-800/60">در حال بارگذاری...</p>}
      </section>
    </div>
  );
}
