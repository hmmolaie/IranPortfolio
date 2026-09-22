'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, setToken, setUserRole } from '@/lib/api';
import {
  canUsePlatformBiometrics,
  defaultDeviceName,
  hasLocalPasskeyFlag,
  isMobileDevice,
  loginWithBiometrics,
  registerDevicePasskey,
  shouldSkipPasskeyPrompt,
  skipPasskeyPrompt,
  type AuthSession,
} from '@/lib/webauthn';

const FEATURES = [
  'پیشنهاد سبد با هوش مصنوعی',
  'دادهٔ بازار سهام تهران',
  'تحلیل صندوق‌ها و اخبار اقتصادی',
];

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard';
  if (raw === '/' || raw === '/login' || raw === '/register') return '/dashboard';
  return raw;
}

function nextFromUrl(): string {
  if (typeof window === 'undefined') return '/dashboard';
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [showBiometric, setShowBiometric] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableBusy, setEnableBusy] = useState(false);

  useEffect(() => {
    if (getToken()) {
      router.replace(nextFromUrl());
      return;
    }
    let cancelled = false;
    canUsePlatformBiometrics()
      .then((ok) => {
        if (cancelled) return;
        setShowBiometric(ok && (isMobileDevice() || hasLocalPasskeyFlag()));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  function finishLogin(res: AuthSession) {
    setToken(res.accessToken);
    setUserRole(res.user.role);
    router.push(nextFromUrl());
  }

  async function maybeOfferPasskey(res: AuthSession) {
    setToken(res.accessToken);
    setUserRole(res.user.role);
    const mobile = isMobileDevice();
    const skip = shouldSkipPasskeyPrompt();
    if (!mobile || skip) {
      router.push(nextFromUrl());
      return;
    }
    try {
      const ok = await canUsePlatformBiometrics();
      if (!ok) {
        router.push(nextFromUrl());
        return;
      }
      const list = await api<Array<{ id: string }>>('/auth/webauthn/credentials');
      if (list.length > 0) {
        router.push(nextFromUrl());
        return;
      }
      setEnableOpen(true);
    } catch {
      router.push(nextFromUrl());
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<AuthSession>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: username, password }),
      });
      await maybeOfferPasskey(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onBiometric() {
    setBioBusy(true);
    setError('');
    try {
      const res = await loginWithBiometrics(username);
      finishLogin(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBioBusy(false);
    }
  }

  async function enablePasskey() {
    setEnableBusy(true);
    setError('');
    try {
      await registerDevicePasskey(defaultDeviceName());
      setEnableOpen(false);
      router.push(nextFromUrl());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnableBusy(false);
    }
  }

  function skipEnable() {
    skipPasskeyPrompt();
    setEnableOpen(false);
    router.push(nextFromUrl());
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2 lg:gap-14">
        <section>
          <p className="text-xs font-medium tracking-[0.28em] text-gold-500" dir="ltr">
            PIIIP
          </p>
          <h1 className="mt-4 text-5xl font-bold leading-tight text-navy-900 sm:text-6xl">پیپ</h1>
          <p className="mt-4 max-w-md text-lg leading-9 text-navy-800/80">
            پلتفرم بینش‌های هوشمند سرمایه‌گذاری شخصی
          </p>
          <p className="mt-2 max-w-md text-sm leading-7 text-navy-800/55" dir="ltr">
            Personal Investment Intelligence Insights Platform
          </p>

          <ul className="mt-8 space-y-3">
            {FEATURES.map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm text-navy-800/80">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900/8 text-xs text-gold-500">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>

          <div className="card mt-8 w-full max-w-md border-navy-900/8 shadow-soft">
            <div className="mb-6 border-b border-navy-900/8 pb-5">
              <h2 className="text-xl font-semibold text-navy-900">ورود به حساب</h2>
              <p className="mt-1 text-sm text-navy-800/55">
                {showBiometric
                  ? 'با اثر انگشت، چهره، یا نام کاربری و رمز عبور وارد شوید'
                  : 'نام کاربری و رمز عبور خود را وارد کنید'}
              </p>
            </div>

            {showBiometric && (
              <div className="mb-5 space-y-3">
                <button
                  type="button"
                  className="btn-primary w-full py-3"
                  disabled={bioBusy || loading || enableBusy}
                  onClick={() => void onBiometric()}
                >
                  {bioBusy ? 'در انتظار تأیید دستگاه...' : 'ورود با اثر انگشت یا چهره'}
                </button>
                <p className="text-center text-xs text-navy-800/45">
                  گوشی اثر انگشت یا تشخیص چهره را نشان می‌دهد
                </p>
                <div className="flex items-center gap-3 text-xs text-navy-800/40">
                  <span className="h-px flex-1 bg-navy-900/10" />
                  یا با رمز عبور
                  <span className="h-px flex-1 bg-navy-900/10" />
                </div>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label" htmlFor="username">
                  نام کاربری
                </label>
                <input
                  id="username"
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username webauthn"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  رمز عبور
                </label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              )}
              <button type="submit" className="btn-primary w-full py-3" disabled={loading || bioBusy}>
                {loading ? 'در حال ورود...' : showBiometric ? 'ورود با رمز عبور' : 'ورود'}
              </button>
            </form>
          </div>

          <p className="mt-6 max-w-md text-xs leading-6 text-navy-800/45">
            این سرویس ابزار تصمیم‌یار است و جایگزین مشاوره رسمی سرمایه‌گذاری نیست.
          </p>
        </section>

        <figure className="mx-auto w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-navy-900/10 shadow-soft lg:max-w-none">
          <img
            src="/brand/login-hero.jpg"
            alt=""
            className="aspect-[4/5] w-full object-cover object-[center_20%] sm:aspect-[5/4] lg:aspect-[4/5] lg:max-h-[40rem]"
          />
        </figure>
      </div>

      {enableOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="webauthn-enable-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-navy-900/10 bg-cream px-5 py-6 shadow-soft">
            <h3 id="webauthn-enable-title" className="text-lg font-semibold text-navy-900">
              ورود سریع روی این گوشی
            </h3>
            <p className="mt-2 text-sm leading-7 text-navy-800/75">
              می‌توانید ورود بعدی را با اثر انگشت یا تشخیص چهره همین دستگاه انجام دهید. رمز عبور همچنان کار می‌کند.
            </p>
            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                className="btn-primary flex-1 py-3"
                disabled={enableBusy}
                onClick={() => void enablePasskey()}
              >
                {enableBusy ? 'در انتظار تأیید دستگاه...' : 'فعال شود'}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1 py-3"
                disabled={enableBusy}
                onClick={skipEnable}
              >
                بعداً
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
