'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, getToken } from '@/lib/api';

type AppUser = {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
  isActive: boolean;
};

type EditMode = 'edit' | 'password' | null;

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '' });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AppUser | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editForm, setEditForm] = useState({ email: '', name: '' });
  const [newPassword, setNewPassword] = useState('');

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

  function openEdit(user: AppUser) {
    setSelected(user);
    setEditMode('edit');
    setEditForm({ email: user.email, name: user.name ?? '' });
    setNewPassword('');
    setMsg('');
  }

  function openPassword(user: AppUser) {
    setSelected(user);
    setEditMode('password');
    setNewPassword('');
    setMsg('');
  }

  function closePanel() {
    setSelected(null);
    setEditMode(null);
    setNewPassword('');
  }

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

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setMsg('');
    try {
      await api(`/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          email: editForm.email.trim(),
          name: editForm.name.trim() || undefined,
        }),
      });
      await loadUsers();
      setMsg('اطلاعات کاربر به‌روز شد.');
      closePanel();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setMsg('');
    try {
      await api(`/users/${selected.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword }),
      });
      setMsg('رمز عبور تغییر کرد.');
      closePanel();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(user: AppUser) {
    const next = !user.isActive;
    const label = next ? 'فعال' : 'غیرفعال';
    if (!confirm(`کاربر «${user.name || user.email}» ${label} شود؟`)) return;
    setLoading(true);
    setMsg('');
    try {
      await api(`/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      await loadUsers();
      setMsg(`کاربر ${label} شد.`);
      if (selected?.id === user.id) closePanel();
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
        <p className="mt-2 text-navy-800/70">ایجاد، ویرایش، تغییر رمز و غیرفعال‌سازی کاربران</p>
      </div>

      {msg && <p className="text-sm text-navy-800">{msg}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">نام نمایشی</th>
              <th className="px-4 py-3 text-start font-medium">نام کاربری</th>
              <th className="px-4 py-3 text-start font-medium">تاریخ ایجاد</th>
              <th className="px-4 py-3 text-start font-medium">وضعیت</th>
              <th className="px-4 py-3 text-start font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={clsx(
                  'border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40',
                  !u.isActive && 'opacity-60',
                )}
              >
                <td className="px-4 py-3 font-medium">{u.name || '—'}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 text-navy-800/70">
                  {new Date(u.createdAt).toLocaleDateString('fa-IR')}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800',
                    )}
                  >
                    {u.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs text-navy-800 hover:underline"
                      onClick={() => openEdit(u)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      className="text-xs text-navy-800 hover:underline"
                      onClick={() => openPassword(u)}
                    >
                      تغییر رمز
                    </button>
                    <button
                      type="button"
                      className={clsx(
                        'text-xs hover:underline',
                        u.isActive ? 'text-red-700' : 'text-emerald-700',
                      )}
                      onClick={() => toggleActive(u)}
                      disabled={loading}
                    >
                      {u.isActive ? 'غیرفعال' : 'فعال‌سازی'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="p-6 text-sm text-navy-800/60">کاربری ثبت نشده.</p>
        )}
      </section>

      {selected && editMode === 'edit' && (
        <form onSubmit={saveEdit} className="card grid max-w-xl gap-4">
          <h2 className="text-lg font-semibold">ویرایش کاربر</h2>
          <div>
            <label className="label">نام کاربری</label>
            <input
              className="input"
              value={editForm.email}
              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">نام نمایشی</label>
            <input
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '...' : 'ذخیره'}
            </button>
            <button type="button" className="btn-secondary" onClick={closePanel}>
              انصراف
            </button>
          </div>
        </form>
      )}

      {selected && editMode === 'password' && (
        <form onSubmit={savePassword} className="card grid max-w-xl gap-4">
          <h2 className="text-lg font-semibold">تغییر رمز — {selected.name || selected.email}</h2>
          <div>
            <label className="label">رمز عبور جدید</label>
            <input
              className="input"
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? '...' : 'تغییر رمز'}
            </button>
            <button type="button" className="btn-secondary" onClick={closePanel}>
              انصراف
            </button>
          </div>
        </form>
      )}

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
