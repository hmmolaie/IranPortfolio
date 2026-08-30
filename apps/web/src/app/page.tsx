'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, setUserRole } from '@/lib/api';

const FEATURES = [
  'پیشنهاد سبد با هوش مصنوعی',
  'دادهٔ بازار سهام تهران',
  'تحلیل صندوق‌ها و اخبار اقتصادی',
];

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: { role: 'ADMIN' | 'USER' } }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: username, password }),
      });
      setToken(res.accessToken);
      setUserRole(res.user.role);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -start-32 top-0 h-96 w-96 rounded-full bg-gold-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -end-24 bottom-0 h-[28rem] w-[28rem] rounded-full bg-navy-900/10 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-2 lg:gap-16 lg:py-0">
        <section className="order-2 lg:order-1">
          <p className="text-xs font-medium tracking-[0.25em] text-gold-500">SABADYAR</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight text-navy-900 sm:text-5xl lg:text-6xl">
            سبدیار
          </h1>
          <p className="mt-5 max-w-md text-base leading-8 text-navy-800/75 sm:text-lg">
            پلتفرم فارسی مدیریت و کشف سبد سرمایه‌گذاری برای بازار ایران — سهام، طلا، سپرده و
            اختیار.
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

          <p className="mt-10 text-xs leading-6 text-navy-800/45">
            این سرویس ابزار تصمیم‌یار است و جایگزین مشاوره رسمی سرمایه‌گذاری نیست.
          </p>
        </section>

        <section className="order-1 lg:order-2">
          <div className="card mx-auto w-full max-w-md border-navy-900/8 shadow-[0_24px_64px_-12px_rgba(11,31,58,0.18)]">
            <div className="mb-6 border-b border-navy-900/8 pb-5">
              <h2 className="text-xl font-semibold text-navy-900">ورود به حساب</h2>
              <p className="mt-1 text-sm text-navy-800/55">نام کاربری و رمز عبور خود را وارد کنید</p>
            </div>

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
                  autoComplete="username"
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
              <button type="submit" className="btn-primary w-full py-3" disabled={loading}>
                {loading ? 'در حال ورود...' : 'ورود'}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
