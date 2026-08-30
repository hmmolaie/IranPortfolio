'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, getToken } from '@/lib/api';

type Macro = {
  inflationPct?: number | null;
  interestRatePct?: number | null;
  usdIrr?: number | null;
  geoRiskScore?: number | null;
  summaryFa?: string | null;
};

export default function MacroPage() {
  const router = useRouter();
  const [macro, setMacro] = useState<Macro | null>(null);
  const [form, setForm] = useState({
    inflationPct: '',
    interestRatePct: '',
    usdIrr: '',
    geoRiskScore: '5',
    summaryFa: '',
  });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{ role?: string }>('/users/me')
      .then((u) => {
        if (u.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
        return api<Macro | null>('/macro/latest', { auth: false });
      })
      .then((m) => {
        if (!m) return;
        setMacro(m);
        setForm({
          inflationPct: m.inflationPct?.toString() ?? '',
          interestRatePct: m.interestRatePct?.toString() ?? '',
          usdIrr: m.usdIrr?.toString() ?? '',
          geoRiskScore: m.geoRiskScore?.toString() ?? '5',
          summaryFa: m.summaryFa ?? '',
        });
      })
      .catch(() => undefined);
  }, [router]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      const saved = await api<Macro>('/macro', {
        method: 'PUT',
        body: JSON.stringify({
          inflationPct: form.inflationPct ? Number(form.inflationPct) : undefined,
          interestRatePct: form.interestRatePct ? Number(form.interestRatePct) : undefined,
          usdIrr: form.usdIrr ? Number(form.usdIrr) : undefined,
          geoRiskScore: Number(form.geoRiskScore),
          summaryFa: form.summaryFa || undefined,
        }),
      });
      setMacro(saved);
      setMsg('شرایط اقتصاد ذخیره شد.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    setAnswer('');
    try {
      const res = await api<{ answer: string }>('/macro/ask', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setAnswer(res.answer);
    } catch (err) {
      setAnswer((err as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">اقتصاد ایران</h1>
        <p className="mt-2 text-navy-800/70">تورم، نرخ بهره، ارز و ریسک ژئوپلیتیک برای زمینه پیشنهاد سبد</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="card">
          <div className="text-sm text-navy-800/50">تورم</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.inflationPct)}٪</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">نرخ بهره</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.interestRatePct)}٪</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">دلار</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.usdIrr)}</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">ریسک ژئوپلیتیک</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.geoRiskScore)}/۱۰</div>
        </div>
      </div>

      <form onSubmit={save} className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">تورم٪</label>
          <input
            className="input"
            value={form.inflationPct}
            onChange={(e) => setForm({ ...form, inflationPct: e.target.value })}
          />
        </div>
        <div>
          <label className="label">نرخ بهره٪</label>
          <input
            className="input"
            value={form.interestRatePct}
            onChange={(e) => setForm({ ...form, interestRatePct: e.target.value })}
          />
        </div>
        <div>
          <label className="label">نرخ دلار (ریال)</label>
          <input
            className="input"
            value={form.usdIrr}
            onChange={(e) => setForm({ ...form, usdIrr: e.target.value })}
          />
        </div>
        <div>
          <label className="label">امتیاز ریسک جنگ/ژئوپلیتیک (۱–۱۰)</label>
          <input
            className="input"
            value={form.geoRiskScore}
            onChange={(e) => setForm({ ...form, geoRiskScore: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">خلاصه شرایط</label>
          <textarea
            className="input min-h-24"
            value={form.summaryFa}
            onChange={(e) => setForm({ ...form, summaryFa: e.target.value })}
          />
        </div>
        <button className="btn-primary w-fit">ذخیره</button>
        {msg && <p className="text-sm">{msg}</p>}
      </form>

      <form onSubmit={ask} className="card space-y-4">
        <h2 className="text-lg font-semibold">پرسش از AI درباره اقتصاد</h2>
        <textarea
          className="input min-h-24"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="مثلاً با تورم فعلی وزن طلا را چقدر پیشنهاد می‌کنی؟"
          required
        />
        <button className="btn-secondary">ارسال سؤال</button>
        {answer && <p className="leading-7 text-navy-800/85">{answer}</p>}
      </form>
    </div>
  );
}
