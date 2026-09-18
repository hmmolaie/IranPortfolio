'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiUrl, getToken } from '@/lib/api';
import { WaitingOverlay } from '@/components/WaitingOverlay';

type Lesson = {
  id: string;
  titleFa: string;
  bodyFa: string;
  source?: string | null;
  createdAt: string;
};

const UPLOAD_STEPS = [
  'خواندن فایل PDF...',
  'استخراج متن اقتصاد ایران...',
  'استخراج درس‌آموخته با AI...',
  'ذخیره در پایگاه برای پیشنهاد سبد...',
];

export default function LessonsPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    const list = await api<Lesson[]>('/lessons');
    setLessons(list);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
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
      const res = await fetch(apiUrl('/lessons/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await readApiError(res));
      const out = (await res.json()) as { createdCount: number; fileName?: string };
      const n = (out.createdCount ?? 0).toLocaleString('fa-IR');
      setMsg(`${n} درس‌آموخته از فایل استخراج و ذخیره شد.`);
      setFile(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">درس‌آموخته‌ها</h1>
        <p className="mt-2 text-navy-800/70">
          یادداشت‌های استخراج‌شده از صندوق‌ها، ارزیابی ماهانه و PDF اقتصاد ایران؛ در پیشنهاد سبد استفاده می‌شوند
        </p>
      </div>

      <form onSubmit={onUpload} className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">فایل PDF اقتصاد ایران</label>
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
            disabled={loading}
          />
          <p className="mt-2 text-xs leading-6 text-navy-800/50">
            متن گزارش به مدل داده می‌شود تا درس‌آموخته‌های مفید برای پیشنهاد سبد سهام استخراج و در پایگاه ذخیره شود.
          </p>
        </div>
        <button className="btn-primary w-fit" disabled={loading || !file}>
          {loading ? 'در حال استخراج...' : 'بارگذاری و استخراج درس‌آموخته'}
        </button>
        {msg && <p className="text-sm sm:col-span-2">{msg}</p>}
      </form>

      <div className="space-y-4">
        {lessons.map((l) => (
          <article key={l.id} className="card">
            <h2 className="text-lg font-semibold">{l.titleFa}</h2>
            <p className="mt-2 whitespace-pre-line leading-7 text-navy-800/80">{l.bodyFa}</p>
            <p className="mt-3 text-xs text-navy-800/40">
              {sourceLabel(l.source)} · {new Date(l.createdAt).toLocaleDateString('fa-IR')}
            </p>
          </article>
        ))}
        {lessons.length === 0 && (
          <p className="card text-sm text-navy-800/60">هنوز درس‌آموخته‌ای ثبت نشده است.</p>
        )}
      </div>

      {loading && (
        <WaitingOverlay
          title="در حال استخراج درس‌آموخته"
          description="متن PDF اقتصاد ایران خوانده می‌شود و مدل درس‌های مفید برای پیشنهاد سبد را می‌سازد. لطفاً صفحه را نبندید."
          steps={UPLOAD_STEPS}
        />
      )}
    </div>
  );
}

function sourceLabel(source?: string | null): string {
  if (!source) return 'نامشخص';
  if (source.startsWith('iran_economy_pdf')) {
    const name = source.slice('iran_economy_pdf'.length).replace(/^:/, '').trim();
    return name ? `PDF اقتصاد ایران · ${name}` : 'PDF اقتصاد ایران';
  }
  if (source === 'fund_report') return 'گزارش صندوق';
  if (source === 'monthly_eval') return 'ارزیابی ماهانه';
  return source;
}

async function readApiError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw) as { message?: string | string[] };
    if (Array.isArray(j.message)) return j.message.join(' ');
    if (typeof j.message === 'string' && j.message.trim()) return j.message;
  } catch {
    /* متن خام */
  }
  return raw || 'بارگذاری ناموفق بود.';
}
