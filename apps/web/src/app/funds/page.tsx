'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, formatNum, getToken } from '@/lib/api';

type Fund = {
  id: string;
  fundName: string;
  reportMonth: string;
  guessedStrategyFa?: string | null;
  rating?: number | null;
  useInSuggestions: boolean;
  lessons: Array<{ id: string; titleFa: string }>;
};

export default function FundsPage() {
  const router = useRouter();
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundName, setFundName] = useState('');
  const [reportMonth, setReportMonth] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/funds`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('خطا');
    setFunds(await res.json());
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load().catch(() => undefined);
  }, [router]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('fundName', fundName);
      fd.append('reportMonth', reportMonth);
      const res = await fetch(`${API_URL}/api/funds/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg('گزارش تحلیل شد و ذخیره گردید.');
      setFile(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`گزارش «${name}» حذف شود؟`)) return;
    setDeletingId(id);
    setMsg('');
    try {
      const res = await fetch(`${API_URL}/api/funds/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(await res.text());
      setFunds((prev) => prev.filter((f) => f.id !== id));
      setMsg('گزارش حذف شد.');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">صندوق‌های سرمایه‌گذاری</h1>
        <p className="mt-2 text-navy-800/70">
          گزارش ماهانه را به‌صورت PDF یا Excel (xlsx/xls) بارگذاری کنید تا ترکیب پرتفوی استخراج و استراتژی مدیر تحلیل شود
        </p>
      </div>

      <form onSubmit={onUpload} className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">نام صندوق</label>
          <input className="input" value={fundName} onChange={(e) => setFundName(e.target.value)} required />
        </div>
        <div>
          <label className="label">ماه گزارش (مثلاً ۱۴۰۴-۱۱)</label>
          <input
            className="input"
            value={reportMonth}
            onChange={(e) => setReportMonth(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">فایل گزارش (PDF یا Excel)</label>
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        <button className="btn-primary w-fit" disabled={loading}>
          {loading ? 'در حال تحلیل...' : 'بارگذاری و تحلیل'}
        </button>
        {msg && <p className="text-sm sm:col-span-2">{msg}</p>}
      </form>

      <div className="space-y-4">
        {funds.map((f) => (
          <article key={f.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{f.fundName}</h2>
                <p className="text-sm text-navy-800/50">گزارش {f.reportMonth}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  امتیاز: <strong>{formatNum(f.rating)}</strong>
                  {f.useInSuggestions && (
                    <span className="ms-2 rounded bg-gold-400/20 px-2 py-0.5 text-xs text-gold-500">
                      قابل استفاده در پیشنهاد
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 text-xs text-red-700 hover:bg-red-50"
                  disabled={deletingId === f.id}
                  onClick={() => onDelete(f.id, f.fundName)}
                >
                  {deletingId === f.id ? 'در حال حذف...' : 'حذف'}
                </button>
              </div>
            </div>
            <p className="mt-3 leading-7 text-navy-800/80">{f.guessedStrategyFa}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
