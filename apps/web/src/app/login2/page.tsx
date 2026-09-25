'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';

const VISIT_KEY = 'mobile-login-visit';

export default function MobileLoginPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [locationNote, setLocationNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<{ enabled: boolean }>(`/mobile-login/status?fresh=${Date.now()}`, {
      auth: false,
      cache: 'no-store',
    })
      .then(async (status) => {
        if (cancelled) return;
        setEnabled(status.enabled);
        if (!status.enabled) return;
        const saved = window.sessionStorage.getItem(VISIT_KEY);
        if (saved) {
          setVisitId(saved);
          return;
        }
        const visit = await api<{ id: string }>('/mobile-login/visits', { method: 'POST', auth: false });
        if (cancelled) return;
        window.sessionStorage.setItem(VISIT_KEY, visit.id);
        setVisitId(visit.id);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visitId) return;
    let cancelled = false;
    (async () => {
      if (!navigator.geolocation) {
        if (!cancelled) setLocationNote('این مرورگر موقعیت را پشتیبانی نمی‌کند.');
        return;
      }
      try {
        const coords = await readCoords();
        if (cancelled) return;
        await api(`/mobile-login/visits/${visitId}/location`, {
          method: 'PATCH',
          auth: false,
          body: JSON.stringify({ location: coords }),
        });
        if (!cancelled) setLocationNote('موقعیت ثبت شد.');
      } catch (e) {
        if (!cancelled) setLocationNote((e as Error).message || 'ثبت موقعیت ممکن نشد.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!visitId) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/mobile-login/visits/${visitId}/mobile`, {
        method: 'PATCH',
        auth: false,
        body: JSON.stringify({ mobilePhone: mobile }),
      });
      setMessage('شماره موبایل ثبت شد. ارسال کد پیامکی هنوز به سامانه وصل نشده است.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <section className="w-full max-w-md rounded-md border border-slate-300 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">ورود با موبایل</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          با باز شدن این صفحه آی‌پی ثبت می‌شود و مرورگر برای موقعیت اجازه می‌خواهد. شمارهٔ موبایل با زدن دکمهٔ
          زیر در همان رکورد می‌نشیند.
        </p>

        {enabled === null && <p className="mt-6 text-sm text-slate-500">در حال بررسی...</p>}
        {enabled === false && (
          <p className="mt-6 text-sm text-slate-700">ورود با موبایل توسط مدیر خاموش شده است.</p>
        )}

        {enabled && (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="mb-1 block text-sm" htmlFor="mobile">
                شماره موبایل
              </label>
              <input
                id="mobile"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-left"
                dir="ltr"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="0912..."
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </div>
            {locationNote && <p className="text-xs leading-6 text-slate-500">{locationNote}</p>}
            <button
              type="submit"
              className="w-full rounded-md bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
              disabled={busy || !visitId}
            >
              {busy ? 'در حال ثبت...' : 'ارسال کد پیامکی'}
            </button>
          </form>
        )}

        {message && <p className="mt-4 text-sm leading-7 text-emerald-800">{message}</p>}
        {error && <p className="mt-4 text-sm leading-7 text-red-700">{error}</p>}
      </section>
    </main>
  );
}

function readCoords(): Promise<string> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        resolve(`${lat},${lng}`);
      },
      () => reject(new Error('اجازهٔ موقعیت داده نشد.')),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}
