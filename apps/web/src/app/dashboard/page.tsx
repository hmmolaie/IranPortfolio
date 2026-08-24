'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatRial, getToken } from '@/lib/api';

type Portfolio = {
  id: string;
  name: string;
  strategy: string;
  capitalRial: number;
  snapshots: Array<{ strategySummaryFa?: string | null }>;
};

export default function DashboardPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{ name?: string }>('/users/me')
      .then((u) => setName(u.name || 'کاربر'))
      .catch(() => router.replace('/login'));
    api<Portfolio[]>('/portfolios').then(setPortfolios).catch(() => undefined);
  }, [router]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-navy-900">سلام، {name}</h1>
        <p className="mt-2 text-navy-800/70">نمای کلی سبدها و مسیر سرمایه‌گذاری شما</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm text-navy-800/60">تعداد سبد</div>
          <div className="mt-2 text-3xl font-semibold">{portfolios.length.toLocaleString('fa-IR')}</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/60">جمع سرمایه</div>
          <div className="mt-2 text-xl font-semibold">
            {formatRial(portfolios.reduce((s, p) => s + p.capitalRial, 0))}
          </div>
        </div>
        <div className="card flex flex-col justify-between">
          <div className="text-sm text-navy-800/60">اقدام سریع</div>
          <Link href="/portfolios" className="btn-primary mt-4 w-fit">
            مدیریت سبدها
          </Link>
        </div>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">سبدهای اخیر</h2>
        <div className="mt-4 divide-y divide-navy-900/8">
          {portfolios.length === 0 && (
            <p className="py-4 text-sm text-navy-800/60">هنوز سبدی ندارید. از صفحه سبدها شروع کنید.</p>
          )}
          {portfolios.map((p) => (
            <Link
              key={p.id}
              href={`/portfolios/${p.id}`}
              className="flex items-center justify-between py-3 hover:bg-navy-50/50"
            >
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-navy-800/50">{p.strategy}</div>
              </div>
              <div className="text-sm">{formatRial(p.capitalRial)}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
