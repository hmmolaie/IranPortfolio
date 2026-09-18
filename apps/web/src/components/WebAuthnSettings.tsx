'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/Toast';
import {
  canUsePlatformBiometrics,
  defaultDeviceName,
  markLocalPasskey,
  registerDevicePasskey,
  type WebAuthnCredentialRow,
} from '@/lib/webauthn';

export function WebAuthnSettings() {
  const toast = useToast();
  const [rows, setRows] = useState<WebAuthnCredentialRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);

  async function load() {
    const list = await api<WebAuthnCredentialRow[]>('/auth/webauthn/credentials');
    setRows(list);
    markLocalPasskey(list.length > 0);
  }

  useEffect(() => {
    load().catch(() => undefined);
    canUsePlatformBiometrics()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);

  async function addDevice() {
    setBusy(true);
    try {
      await registerDevicePasskey(defaultDeviceName());
      await load();
      toast.success('ورود با اثر انگشت یا چهره برای این دستگاه فعال شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('این دستگاه از ورود زیست‌سنجی حذف شود؟')) return;
    setBusy(true);
    try {
      await api(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' });
      await load();
      toast.success('دستگاه حذف شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">اثر انگشت و تشخیص چهره</h2>
        <p className="mt-1 text-sm leading-7 text-navy-800/70">
          روی گوشی می‌توانید ورود را با اثر انگشت یا چهره همان دستگاه فعال کنید. سایت باید با دامنه و
          HTTPS باز شود؛ روی آدرس IP کار نمی‌کند.
        </p>
      </div>

      {!supported && (
        <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800/70">
          این مرورگر یا این مبدأ، زیست‌سنجی دستگاه را پشتیبانی نمی‌کند. از مرورگر به‌روز روی گوشی و
          نسخهٔ HTTPS دامنه استفاده کنید.
        </p>
      )}

      <button type="button" className="btn-primary w-fit" disabled={busy || !supported} onClick={() => void addDevice()}>
        {busy ? 'در انتظار تأیید دستگاه...' : 'فعال‌سازی روی این دستگاه'}
      </button>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-900/10 bg-white px-3 py-3"
          >
            <div>
              <div className="text-sm font-medium">{row.friendlyName || 'دستگاه ثبت‌شده'}</div>
              <div className="mt-0.5 text-xs text-navy-800/45">
                {new Date(row.createdAt).toLocaleDateString('fa-IR')}
                {row.lastUsedAt
                  ? ` · آخرین ورود ${new Date(row.lastUsedAt).toLocaleDateString('fa-IR')}`
                  : ''}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={() => void remove(row.id)}
            >
              حذف
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-navy-800/55">هنوز دستگاهی برای ورود زیست‌سنجی ثبت نشده است.</li>
        )}
      </ul>
    </section>
  );
}
