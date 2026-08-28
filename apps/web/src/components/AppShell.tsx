'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getToken, setToken } from '@/lib/api';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

const links = [
  { href: '/dashboard', label: 'داشبورد' },
  { href: '/market', label: 'بازار سهام تهران' },
  { href: '/portfolios', label: 'سبدها' },
  { href: '/funds', label: 'صندوق‌ها' },
  { href: '/lessons', label: 'درس‌آموخته‌ها' },
  { href: '/macro', label: 'اقتصاد ایران' },
  { href: '/news', label: 'اخبار اقتصادی ایران' },
  { href: '/settings', label: 'تنظیمات' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const isAuthPage = pathname === '/login' || pathname === '/register' || pathname === '/';

  useEffect(() => {
    setAuthed(Boolean(getToken()));
  }, [pathname]);

  function logout() {
    setToken(null);
    setAuthed(false);
    router.push('/login');
  }

  if (isAuthPage) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-navy-900/10 bg-navy-900 text-white lg:border-b-0 lg:border-e lg:border-navy-800">
        <div className="px-6 py-7">
          <Link href="/dashboard" className="block">
            <div className="text-2xl font-bold tracking-tight">سبدیار</div>
            <div className="mt-1 text-xs text-white/60">بانک خصوصی سبد شما</div>
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
        {authed && (
          <div className="hidden px-6 pb-6 lg:block">
            <button onClick={logout} className="text-sm text-white/50 hover:text-white">
              خروج
            </button>
          </div>
        )}
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-navy-900/8 bg-white/70 px-6 py-4 backdrop-blur">
          <p className="text-sm text-navy-800/70">خروجی سایت مشاوره سرمایه‌گذاری رسمی نیست.</p>
          <button onClick={logout} className="text-sm text-navy-800/60 hover:text-navy-900 lg:hidden">
            خروج
          </button>
        </header>
        <main className="px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
