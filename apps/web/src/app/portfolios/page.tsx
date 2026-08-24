'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatRial, getToken } from '@/lib/api';

const STRATEGIES = [
  { value: 'GROWTH', label: 'رشدی' },
  { value: 'VALUE', label: 'ارزشی' },
  { value: 'INCOME', label: 'درآمدی' },
  { value: 'HEDGED', label: 'پوششی' },
  { value: 'CONSERVATIVE', label: 'محافظه‌کار' },
  { value: 'CUSTOM', label: 'سفارشی' },
];

type Portfolio = {
  id: string;
  name: string;
  strategy: string;
  capitalRial: number;
};

export default function PortfoliosPage() {
  const router = useRouter();
  const [items, setItems] = useState<Portfolio[]>([]);
  const [name, setName] = useState('سبد اصلی');
  const [strategy, setStrategy] = useState('GROWTH');
  const [capital, setCapital] = useState('1000000000');
  const [error, setError] = useState('');

  async function load() {
    setItems(await api<Portfolio[]>('/portfolios'));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => router.replace('/login'));
  }, [router]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const p = await api<Portfolio>('/portfolios', {
        method: 'POST',
        body: JSON.stringify({
          name,
          strategy,
          capitalRial: Number(capital),
        }),
      });
      router.push(`/portfolios/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">سبدها</h1>
        <p className="mt-2 text-navy-800/70">چند سبد با استراتژی‌های مختلف تعریف کنید</p>
      </div>

      <form onSubmit={onCreate} className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">نام سبد</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">استراتژی</label>
          <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">سرمایه (ریال)</label>
          <input className="input" value={capital} onChange={(e) => setCapital(e.target.value)} required />
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full">ایجاد سبد</button>
        </div>
        {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((p) => (
          <Link key={p.id} href={`/portfolios/${p.id}`} className="card transition hover:border-gold-400/40">
            <div className="text-lg font-semibold">{p.name}</div>
            <div className="mt-1 text-sm text-navy-800/60">
              {STRATEGIES.find((s) => s.value === p.strategy)?.label ?? p.strategy}
            </div>
            <div className="mt-4 text-navy-900">{formatRial(p.capitalRial)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
