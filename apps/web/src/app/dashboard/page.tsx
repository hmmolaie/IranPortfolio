'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatRial, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';

type Portfolio = {
  id: string;
  name: string;
  strategy: string;
  capitalRial: number;
  snapshots: Array<{ strategySummaryFa?: string | null }>;
};

type AppUser = {
  id: string;
  email: string;
  name?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');

  async function loadPortfolios(userId?: string) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    const data = await api<Portfolio[]>(`/portfolios${q}`);
    setPortfolios(data);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{ name?: string; role?: UserRole }>('/users/me')
      .then((u) => {
        setName(u.name || (u.role === 'ADMIN' ? 'مدیر' : 'کاربر'));
        const r = u.role ?? getUserRole();
        if (r) setUserRole(r);
        setRole(r ?? null);
        if (r === 'ADMIN') {
          return api<AppUser[]>('/users').then((list) => {
            setUsers(list);
            if (list[0]) setSelectedUserId(list[0].id);
          });
        }
        return loadPortfolios();
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  useEffect(() => {
    if (role === 'ADMIN' && selectedUserId) {
      loadPortfolios(selectedUserId).catch(() => undefined);
    }
  }, [role, selectedUserId]);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-navy-900">سلام، {name}</h1>
        <p className="mt-2 text-navy-800/70">
          {role === 'ADMIN'
            ? 'نمای کلی سبد کاربران — فقط مشاهده'
            : 'نمای کلی سبدها و مسیر سرمایه‌گذاری شما'}
        </p>
      </div>

      {role === 'ADMIN' && (
        <div className="card max-w-md">
          <label className="label">انتخاب کاربر</label>
          <select
            className="input"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
          {users.length === 0 && (
            <p className="mt-2 text-sm text-navy-800/50">هنوز کاربری تعریف نشده.</p>
          )}
          {selectedUser && (
            <p className="mt-2 text-xs text-navy-800/50">نام کاربری: {selectedUser.email}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm text-navy-800/60">تعداد سبد</div>
          <div className="mt-2 text-3xl font-semibold">{portfolios.length.toLocaleString('fa-IR')}</div>
        </div>
        <div className="card">
          <div className="text-sm text-navy-800/60">جمع سرمایه</div>
          <div className="mt-2 text-xl font-semibold">
            {formatRial(portfolios.reduce((s, p) => s + p.capitalRial, 0))}
          </div>
        </div>
        <div className="card flex flex-col justify-between">
          <div className="text-sm text-navy-800/60">اقدام سریع</div>
          {role === 'ADMIN' ? (
            <Link href="/settings" className="btn-secondary mt-4 w-fit">
              مدیریت کاربران
            </Link>
          ) : (
            <Link href="/portfolios" className="btn-primary mt-4 w-fit">
              مدیریت سبدها
            </Link>
          )}
        </div>
      </div>

      <section className="card">
        <h2 className="text-lg font-semibold">
          {role === 'ADMIN' && selectedUser
            ? `سبدهای ${selectedUser.name || selectedUser.email}`
            : 'سبدهای اخیر'}
        </h2>
        <div className="mt-4 divide-y divide-navy-900/8">
          {portfolios.length === 0 && (
            <p className="py-4 text-sm text-navy-800/60">سبدی ثبت نشده.</p>
          )}
          {portfolios.map((p) => (
            <Link
              key={p.id}
              href={`/portfolios/${p.id}`}
              className="flex items-center justify-between py-3 hover:bg-navy-50/50"
            >
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-navy-800/50">{p.strategy}</div>
              </div>
              <div className="text-sm">{formatRial(p.capitalRial)}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
