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

async function downloadBackup(name: string) {
  const token = getToken();
  const res = await fetch(apiUrl(`/admin/backup/download/${encodeURIComponent(name)}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 180) || 'دانلود ناموفق بود');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
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
    load().catch((e) => setError((e as Error).message));
  }, [router]);

  async function createBackup() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const created = await api<BackupItem>('/admin/backup', { method: 'POST' });
      await downloadBackup(created.name);
      await load();
      setNotice('نسخه پشتیبان ساخته و دانلود شد.');
    } catch (e) {
      setError((e as Error).message);
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
      setError((err as Error).message);
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

      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-emerald-800">{notice}</p>}

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">نسخه پشتیبان</h2>
        <button type="button" className="btn-primary w-fit" disabled={busy} onClick={() => void createBackup()}>
          {busy ? 'در حال کار...' : 'تهیه و دانلود'}
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
                        downloadBackup(item.name).catch((e) => setError((e as Error).message));
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
