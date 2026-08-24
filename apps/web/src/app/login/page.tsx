'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      });
      setToken(res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-2xl font-bold text-navy-900">
        سبدیار
      </Link>
      <div className="card">
        <h1 className="text-xl font-semibold">ورود</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="label">ایمیل</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">رمز عبور</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? '...' : 'ورود'}
          </button>
        </form>
        <p className="mt-4 text-sm text-navy-800/60">
          حساب ندارید؟{' '}
          <Link href="/register" className="text-navy-900 underline">
            ثبت‌نام
          </Link>
        </p>
      </div>
    </div>
  );
}
