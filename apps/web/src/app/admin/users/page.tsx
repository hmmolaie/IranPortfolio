'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

type AppUser = {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadUsers() {
    const list = await api<AppUser[]>('/users');
    setUsers(list);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{ role?: string }>('/users/me')
      .then((u) => {
        if (u.role !== 'ADMIN') router.replace('/dashboard');
        else return loadUsers();
      })
      .catch(() => router.replace('/dashboard'));
  }, [router]);

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newUser.email.trim(),
          password: newUser.password,
          name: newUser.name.trim() || undefined,
        }),
      });
      setNewUser({ email: '', password: '', name: '' });
      await loadUsers();
      setMsg('کاربر جدید ایجاد شد.');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">مدیریت کاربران</h1>
        <p className="mt-2 text-navy-800/70">ایجاد و مشاهده کاربران سیستم</p>
      </div>

      {msg && <p className="text-sm text-navy-800">{msg}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">نام نمایشی</th>
              <th className="px-4 py-3 text-start font-medium">نام کاربری</th>
              <th className="px-4 py-3 text-start font-medium">تاریخ ایجاد</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                <td className="px-4 py-3 font-medium">{u.name || '—'}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 text-navy-800/70">
                  {new Date(u.createdAt).toLocaleDateString('fa-IR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">کاربری ثبت نشده.</p>
        )}
      </section>

      <form onSubmit={addUser} className="card grid max-w-xl gap-4">
        <h2 className="text-lg font-semibold">افزودن کاربر</h2>
        <div>
          <label className="label">نام کاربری</label>
          <input
            className="input"
            value={newUser.email}
            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">رمز عبور</label>
          <input
            className="input"
            type="password"
            minLength={6}
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">نام نمایشی (اختیاری)</label>
          <input
            className="input"
            value={newUser.name}
            onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
          />
        </div>
        <button type="submit" className="btn-primary w-fit" disabled={loading}>
          {loading ? '...' : 'افزودن کاربر'}
        </button>
      </form>
    </div>
  );
}
