'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken } from '@/lib/api';
import { useToast } from '@/components/Toast';

type Macro = {
  inflationPct?: number | null;
  interestRatePct?: number | null;
  usdIrr?: number | null;
  goldGramRial?: number | null;
  geoRiskScore?: number | null;
  summaryFa?: string | null;
  spotDateKey?: string | null;
  sourceNoteFa?: string | null;
};

export default function MacroPage() {
  const router = useRouter();
  const toast = useToast();
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
  const [saving, setSaving] = useState(false);
  const [spotBusy, setSpotBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
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
    setSaving(true);
    try {
      const usd = form.usdIrr.trim() ? Number(form.usdIrr.replace(/,/g, '')) : undefined;
      if (usd != null && (!Number.isFinite(usd) || usd <= 0)) {
        toast.error('نرخ دلار باید عدد مثبت باشد.');
        setSaving(false);
        return;
      }
      const saved = await api<Macro>('/macro', {
        method: 'PUT',
        body: JSON.stringify({
          inflationPct: form.inflationPct ? Number(form.inflationPct) : undefined,
          interestRatePct: form.interestRatePct ? Number(form.interestRatePct) : undefined,
          usdIrr: usd,
          geoRiskScore: Number(form.geoRiskScore),
          summaryFa: form.summaryFa || undefined,
        }),
      });
      setMacro(saved);
      setForm((prev) => ({
        ...prev,
        usdIrr: saved.usdIrr?.toString() ?? prev.usdIrr,
      }));
      toast.success(
        usd != null
          ? 'شرایط اقتصاد و نرخ دلار امروز ذخیره شد.'
          : 'شرایط اقتصاد ذخیره شد.',
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshSpot() {
    setSpotBusy(true);
    try {
      await api('/prices/refresh', { method: 'POST' });
      const m = await api<Macro | null>('/macro/latest');
      if (m) {
        setMacro(m);
        setForm((prev) => ({
          ...prev,
          usdIrr: m.usdIrr?.toString() ?? prev.usdIrr,
        }));
      }
      toast.success('دلار و طلای ۱۸ عیار از بیت‌پین به‌روز شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSpotBusy(false);
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
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">اقتصاد ایران</h1>
          <p className="mt-2 text-navy-800/70">تورم، نرخ بهره، ارز، طلا و ریسک ژئوپلیتیک برای زمینه پیشنهاد سبد</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={refreshSpot}
            disabled={spotBusy}
          >
            {spotBusy ? 'در حال به‌روزرسانی...' : 'به‌روزرسانی دلار و طلا'}
          </button>
          <Link href="/macro/prices" className="btn-secondary">
            روند قیمت دلار و طلا
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="card">
          <div className="text-sm text-navy-800/50">تورم</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.inflationPct)}٪</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">نرخ بهره</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.interestRatePct)}٪</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">دلار آزاد (تتر)</div>
          <div className="mt-2 text-xl font-semibold leading-8">
            {macro?.usdIrr ? formatRial(macro.usdIrr) : '—'}
          </div>
          {macro?.spotDateKey && (
            <div className="mt-1 text-xs text-navy-800/45">{macro.spotDateKey}</div>
          )}
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">طلای ۱۸ عیار (گرم)</div>
          <div className="mt-2 text-xl font-semibold leading-8">
            {macro?.goldGramRial ? formatRial(macro.goldGramRial) : '—'}
          </div>
          {macro?.spotDateKey && (
            <div className="mt-1 text-xs text-navy-800/45">{macro.spotDateKey}</div>
          )}
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/50">ریسک ژئوپلیتیک</div>
          <div className="mt-2 text-2xl font-semibold">{formatNum(macro?.geoRiskScore)}/۱۰</div>
        </div>
      </div>
      {macro?.sourceNoteFa && (
        <p className="text-xs text-navy-800/50">{macro.sourceNoteFa}</p>
      )}

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
            inputMode="numeric"
            dir="ltr"
            placeholder="مثلاً 850000"
          />
          <p className="mt-1 text-xs text-navy-800/50">
            برای قیمت بازار آزاد، دکمهٔ به‌روزرسانی دلار و طلا را بزنید. ذخیرهٔ دستی فقط در صورت نیاز.
          </p>
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
        <button className="btn-primary w-fit" disabled={saving}>
          {saving ? 'در حال ذخیره...' : 'ذخیره'}
        </button>
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
