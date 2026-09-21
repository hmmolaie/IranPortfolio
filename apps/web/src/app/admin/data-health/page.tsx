'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getUserRole } from '@/lib/api';

type Source = {
  nameFa: string;
  count: number;
  last: string | null;
  status: 'ok' | 'warn' | 'empty';
};

const STATUS_FA = {
  ok: 'به‌روز',
  warn: 'کهنه',
  empty: 'خالی',
};

export default function DataHealthPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Source[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'ADMIN') {
      router.replace('/dashboard');
      return;
    }
    api<{ sources: Source[] }>('/intelligence/data-health')
      .then((data) => setRows(data.sources))
      .catch((e) => setError((e as Error).message));
  }, [router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">سلامت داده</h1>
        <p className="mt-2 text-navy-800/70">وضعیت آخرین به‌روزرسانی منابع داخلی. این صفحه ابزار عملیاتی مدیر است.</p>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-navy-800/55">
              <th className="py-2 text-start">منبع</th>
              <th className="py-2 text-start">وضعیت</th>
              <th className="py-2 text-start">تعداد</th>
              <th className="py-2 text-start">آخرین رکورد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.nameFa} className="border-t border-navy-900/10">
                <td className="py-2">{row.nameFa}</td>
                <td className="py-2">{STATUS_FA[row.status]}</td>
                <td className="py-2">{row.count.toLocaleString('fa-IR')}</td>
                <td className="py-2" dir="ltr">
                  {row.last ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
