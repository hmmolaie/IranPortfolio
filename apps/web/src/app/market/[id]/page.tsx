'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';

type Bar = {
  tradeDate: string;
  lastPrice?: number | null;
  closePrice?: number | null;
  eps?: number | null;
  pe?: number | null;
  volume?: number | null;
};

type Instrument = {
  id: string;
  symbol: string;
  nameFa: string;
  assetType: string;
  insCode?: string | null;
  last: Bar | null;
};

function PriceChart({ bars }: { bars: Bar[] }) {
  const prices = bars.map((b) => b.closePrice ?? b.lastPrice ?? 0).filter((p) => p > 0);
  if (prices.length < 2) {
    return <p className="text-sm text-navy-800/60">دادهٔ تاریخی کافی برای نمودار نیست.</p>;
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 640;
  const h = 220;
  const pad = 24;
  const points = prices
    .map((p, i) => {
      const x = pad + (i / (prices.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-3xl" role="img" aria-label="نمودار قیمت">
        <polyline fill="none" stroke="#0b1f3a" strokeWidth="2" points={points} />
        <text x={pad} y={16} className="fill-navy-800 text-[10px]">
          {formatNum(max)}
        </text>
        <text x={pad} y={h - 6} className="fill-navy-800 text-[10px]">
          {formatNum(min)}
        </text>
      </svg>
      <p className="mt-2 text-xs text-navy-800/50">
        {bars.length} روز · قیمت پایانی/آخر
      </p>
    </div>
  );
}

export default function MarketInstrumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inst, setInst] = useState<Instrument | null>(null);
  const [history, setHistory] = useState<Bar[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    Promise.all([
      api<Instrument>(`/market/instruments/${id}`),
      api<Bar[]>(`/market/instruments/${id}/history?limit=120`),
    ])
      .then(([i, h]) => {
        setInst(i);
        setHistory(h);
      })
      .catch(() => router.replace('/market'));
  }, [id, router]);

  if (!inst) return <p className="text-navy-800/60">در حال بارگذاری...</p>;

  return (
    <div className="space-y-6">
      <Link href="/market" className="text-sm text-navy-800/60 hover:text-navy-900">
        ← بازگشت به بازار سهام تهران
      </Link>
      <div>
        <h1 className="text-3xl font-bold">{inst.symbol}</h1>
        <p className="mt-1 text-navy-800/70">{inst.nameFa}</p>
      </div>

      <div className="card grid gap-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-navy-800/50">آخرین</div>
          <div className="text-lg font-semibold">{formatNum(inst.last?.lastPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-navy-800/50">پایانی</div>
          <div className="text-lg font-semibold">{formatNum(inst.last?.closePrice)}</div>
        </div>
        <div>
          <div className="text-xs text-navy-800/50">EPS</div>
          <div className="text-lg font-semibold">{formatNum(inst.last?.eps)}</div>
        </div>
        <div>
          <div className="text-xs text-navy-800/50">P/E</div>
          <div className="text-lg font-semibold">{formatNum(inst.last?.pe)}</div>
        </div>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">تغییرات قیمت</h2>
        <div className="mt-4">
          <PriceChart bars={history} />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 text-lg font-semibold">جدول تاریخی</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-navy-900/10 text-start">
              <th className="py-2 pe-4">تاریخ</th>
              <th className="py-2 pe-4">آخرین</th>
              <th className="py-2 pe-4">پایانی</th>
              <th className="py-2 pe-4">حجم</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().slice(0, 30).map((b, idx) => (
              <tr key={idx} className="border-b border-navy-900/5">
                <td className="py-2 pe-4">
                  {new Date(b.tradeDate).toLocaleDateString('fa-IR')}
                </td>
                <td className="py-2 pe-4">{formatNum(b.lastPrice)}</td>
                <td className="py-2 pe-4">{formatNum(b.closePrice)}</td>
                <td className="py-2 pe-4">{formatNum(b.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
