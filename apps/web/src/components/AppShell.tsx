'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, clearSession, api, getUserRole, setUserRole, UserRole, touchSession, refreshSessionIfNeeded, sessionTimedOut } from '@/lib/api';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ToastProvider } from '@/components/Toast';
import { InstallAppPrompt } from '@/components/InstallAppPrompt';

const allLinks = [
  { href: '/dashboard', label: 'داشبورد', adminOnly: false },
  { href: '/market', label: 'بازار سهام تهران', adminOnly: false },
  { href: '/portfolios', label: 'سبدها', adminOnly: false },
  { href: '/funds', label: 'صندوق‌ها', adminOnly: true },
  { href: '/lessons', label: 'درس‌آموخته‌ها', adminOnly: true },
  { href: '/macro', label: 'اقتصاد ایران', adminOnly: true },
  { href: '/world', label: 'اقتصاد دنیا', adminOnly: true },
  { href: '/news', label: 'اخبار اقتصادی ایران', adminOnly: false },
  { href: '/forex', label: 'آزمایش فارکس', adminOnly: true },
  { href: '/admin/users', label: 'مدیریت کاربران', adminOnly: true },
  { href: '/admin/data-health', label: 'سلامت داده', adminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [userLabel, setUserLabel] = useState('');
  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname === '/';

  useEffect(() => {
    const token = getToken();
    const hasToken = Boolean(token);
    setAuthed(hasToken);
    setReady(true);

    if (!isAuthPage && !hasToken) {
      router.replace('/');
      return;
    }

    if (!hasToken) {
      setRole(null);
      setUserLabel('');
      return;
    }

    const cached = getUserRole();
    if (cached) setRole(cached);
    api<{ role?: UserRole; email?: string; name?: string | null }>('/users/me')
      .then((u) => {
        if (u.role) {
          setUserRole(u.role);
          setRole(u.role);
        }
        setUserLabel(u.name?.trim() || u.email || '');
      })
      .catch(() => {
        clearSession();
        setAuthed(false);
        setRole(null);
        setUserLabel('');
        if (!isAuthPage) router.replace('/');
      });
  }, [pathname, router, isAuthPage]);

  useEffect(() => {
    if (isAuthPage) return;

    function logoutIdle() {
      clearSession();
      setAuthed(false);
      setRole(null);
      setUserLabel('');
      router.replace('/');
    }

    function onActivity() {
      if (sessionTimedOut()) {
        logoutIdle();
        return;
      }
      touchSession();
      void refreshSessionIfNeeded();
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    const tick = window.setInterval(() => {
      if (sessionTimedOut()) logoutIdle();
    }, 5000);

    const onVis = () => {
      if (document.visibilityState === 'visible') onActivity();
    };
    document.addEventListener('visibilitychange', onVis);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sabadyar_token' && !e.newValue) logoutIdle();
    };
    window.addEventListener('storage', onStorage);

    if (getToken()) {
      touchSession();
      void refreshSessionIfNeeded();
    }

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, onActivity);
      }
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('storage', onStorage);
    };
  }, [isAuthPage, router]);

  const links = allLinks.filter((l) => !l.adminOnly || role === 'ADMIN');

  function logout() {
    clearSession();
    setAuthed(false);
    setRole(null);
    setUserLabel('');
    window.location.assign('/');
  }

  if (isAuthPage) {
    return (
      <ToastProvider>
        <main className="min-h-screen">{children}</main>
      </ToastProvider>
    );
  }

  if (!ready || !authed) {
    return (
      <ToastProvider>
        <main className="flex min-h-screen items-center justify-center text-navy-800/60">
          در حال بررسی ورود...
        </main>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-gold-400/25 bg-navy-900 text-white lg:border-b-0 lg:border-e lg:border-gold-400/20">
          <div className="border-b border-white/10 px-6 py-7">
            <Link href="/dashboard" className="block">
              <div className="text-2xl font-bold tracking-tight">پیپ</div>
              <div className="mt-1 text-[11px] leading-5 text-gold-400/90">
                بینش هوشمند سرمایه‌گذاری شخصی
              </div>
            </Link>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col lg:overflow-visible">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  'whitespace-nowrap rounded-lg px-3 py-2.5 text-sm transition',
                  pathname.startsWith(l.href)
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-900/8 bg-white/70 px-6 py-4 backdrop-blur">
            <p className="text-sm text-navy-800/70">
              خروجی سایت مشاوره سرمایه‌گذاری رسمی نیست.
            </p>
            <div className="flex items-center gap-3 text-sm">
              {userLabel && (
                <span className="max-w-[10rem] truncate font-medium text-navy-900" title={userLabel}>
                  {userLabel}
                </span>
              )}
              <Link
                href="/settings"
                className={clsx(
                  'rounded-lg px-2.5 py-1.5 transition',
                  pathname.startsWith('/settings')
                    ? 'bg-navy-900/10 font-medium text-navy-900'
                    : 'text-navy-800/65 hover:bg-navy-900/5 hover:text-navy-900',
                )}
              >
                تنظیمات
              </Link>
              <button
                type="button"
                onClick={logout}
                className="rounded-lg px-2.5 py-1.5 text-navy-800/55 transition hover:bg-navy-900/5 hover:text-navy-900"
              >
                خروج
              </button>
            </div>
          </header>
          <main className="px-4 py-8 sm:px-8">{children}</main>
          <InstallAppPrompt />
        </div>
      </div>
    </ToastProvider>
  );
}
