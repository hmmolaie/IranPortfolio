'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, apiUrl, getToken, getUserRole } from '@/lib/api';

type BackupItem = {
  name: string;
  bytes: number;
  createdAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('fa-IR')} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`;
}

function visibleError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'ارتباط با سرور قطع شد و پاسخ نرسید. اگر ساخت یا دانلود پشتیبان طولانی شده، پروکسی اتصال را بسته است. دوباره تلاش کنید.';
  }
  return message.trim() || 'عملیات پشتیبان ناموفق بود';
}

async function readErrorText(res: Response): Promise<string> {
  const text = (await res.text().catch(() => '')).trim();
  if (!text) return `پاسخ سرور خطای ${res.status} بود`;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (Array.isArray(parsed.message)) return parsed.message.map(String).join('، ');
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    /* متن خام */
  }
  return text.slice(0, 2000);
}

async function downloadBackup(name: string) {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(`/admin/backup/download/${encodeURIComponent(name)}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    throw new Error(visibleError(err));
  }
  if (!res.ok) throw new Error(await readErrorText(res));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function waitForBackup(): Promise<string> {
  const started = Date.now();
  for (;;) {
    const job = await api<{ status: string; name?: string; messageFa?: string }>('/admin/backup/job');
    if (job.status === 'ready' && job.name) return job.name;
    if (job.status === 'error') throw new Error(job.messageFa || 'ساخت نسخه پشتیبان ناموفق بود');
    if (job.status === 'idle') throw new Error('ساخت نسخه پشتیبان شروع نشد.');
    if (Date.now() - started > 15 * 60 * 1000) {
      throw new Error('ساخت نسخه پشتیبان بیش از ۱۵ دقیقه طول کشید و تمام نشد.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export default function SupportPage() {
  const router = useRouter();
  const [items, setItems] = useState<BackupItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    const data = await api<{ items: BackupItem[] }>('/admin/backup');
    setItems(data.items);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'ADMIN') {
      router.replace('/dashboard');
      return;
    }
    load().catch((e) => setError(visibleError(e)));
  }, [router]);

  async function createBackup() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/backup', { method: 'POST' });
      setNotice('در حال ساخت نسخه پشتیبان. تا پایان کار این صفحه را نبندید.');
      const name = await waitForBackup();
      await downloadBackup(name);
      await load();
      setNotice('نسخه پشتیبان ساخته و دانلود شد.');
    } catch (e) {
      setError(visibleError(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      if (file) body.append('file', file);
      body.append('confirm', confirm);
      const res = await api<{ messageFa: string }>('/admin/backup/restore', {
        method: 'POST',
        body,
      });
      setNotice(res.messageFa);
      setConfirm('');
      setFile(null);
    } catch (err) {
      setError(visibleError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">پشتیبانی</h1>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-navy-800/70">
          نسخه پشتیبان کل پایگاه داده فقط برای مدیر است. فایل را دانلود و بیرون از سرور نگه دارید. بازیابی، دادهٔ فعلی را با همین فایل عوض می‌کند.
        </p>
      </div>

      {error && (
        <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-3 text-sm leading-7 text-red-800" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-emerald-800">{notice}</p>}

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">نسخه پشتیبان</h2>
        <button type="button" className="btn-primary w-fit" disabled={busy} onClick={() => void createBackup()}>
          {busy ? 'در حال ساخت و دانلود...' : 'تهیه و دانلود'}
        </button>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-navy-800/55">
                <th className="py-2 text-start">فایل</th>
                <th className="py-2 text-start">حجم</th>
                <th className="py-2 text-start">زمان</th>
                <th className="py-2 text-start">دانلود</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.name} className="border-t border-navy-900/10">
                  <td className="py-2" dir="ltr">
                    {item.name}
                  </td>
                  <td className="py-2">{formatBytes(item.bytes)}</td>
                  <td className="py-2" dir="ltr">
                    {item.createdAt.replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-navy-900 underline"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        downloadBackup(item.name).catch((e) => setError(visibleError(e)));
                      }}
                    >
                      دانلود
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="py-3 text-navy-800/50" colSpan={4}>
                    هنوز نسخه‌ای روی سرور نیست.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <form onSubmit={restore} className="card space-y-4">
        <h2 className="text-lg font-semibold">بازیابی</h2>
        <p className="text-sm leading-7 text-navy-800/70">
          فقط فایل دانلودشده از همین بخش را بگذارید. برای تأیید، عبارت «بازیابی» را بنویسید. تا پایان کار از بقیهٔ بخش‌ها استفاده نکنید.
        </p>
        <input
          className="input"
          type="file"
          accept=".dump,application/octet-stream"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div>
          <label className="label">عبارت تأیید</label>
          <input className="input max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" className="btn-secondary w-fit" disabled={busy || !file}>
          بازیابی پایگاه
        </button>
      </form>
    </div>
  );
}
