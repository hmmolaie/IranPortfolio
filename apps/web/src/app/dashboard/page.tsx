'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';

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
  const [home, setHome] = useState<{
    regime: { labelFa: string; summaryFa: string };
    portfolio: {
      id: string;
      name: string;
      health: { score: number | null };
      risk: { score: number | null };
      alerts: Array<{ titleFa: string; bodyFa: string }>;
      plan: Array<{ labelFa: string; action: string; currentPct: number; targetPct: number }>;
    } | null;
  } | null>(null);

  async function loadPortfolios(userId?: string) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    const data = await api<Portfolio[]>(`/portfolios${q}`);
    setPortfolios(data);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
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
      .catch(() => router.replace('/'));
  }, [router]);

  useEffect(() => {
    if (role === 'ADMIN' && selectedUserId) {
      loadPortfolios(selectedUserId).catch(() => undefined);
    }
  }, [role, selectedUserId]);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  useEffect(() => {
    if (role !== 'USER') return;
    api<NonNullable<typeof home>>('/intelligence/home')
      .then(setHome)
      .catch(() => undefined);
  }, [role]);

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

      {role === 'USER' && home && (
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="card">
            <div className="text-sm text-navy-800/60">رژیم بازار</div>
            <div className="mt-2 text-xl font-semibold">{home.regime.labelFa}</div>
            <p className="mt-2 text-sm leading-6 text-navy-800/70">{home.regime.summaryFa}</p>
          </div>
          <div className="card">
            <div className="text-sm text-navy-800/60">سلامت و ریسک</div>
            <div className="mt-2 text-sm leading-7">
              {home.portfolio
                ? `${home.portfolio.name}: سلامت ${home.portfolio.health.score == null ? 'نامشخص' : home.portfolio.health.score.toLocaleString('fa-IR')}، ریسک ${home.portfolio.risk.score == null ? 'نامشخص' : formatNum(home.portfolio.risk.score)}`
                : 'هنوز سبدی برای سنجش نیست.'}
            </div>
          </div>
          <div className="card">
            <div className="text-sm text-navy-800/60">چه چیزی باید عوض شود</div>
            <p className="mt-2 text-sm leading-7 text-navy-800/75">
              {home.portfolio?.plan[0]
                ? `${home.portfolio.plan[0].labelFa}: ${formatNum(home.portfolio.plan[0].currentPct)}٪ به ${formatNum(home.portfolio.plan[0].targetPct)}٪`
                : home.portfolio?.alerts[0]
                  ? `${home.portfolio.alerts[0].titleFa}. ${home.portfolio.alerts[0].bodyFa}`
                  : 'فاصلهٔ مهمی از وزن هدف، با دادهٔ موجود، دیده نشد.'}
            </p>
            {home.portfolio && (
              <Link href={`/portfolios/${home.portfolio.id}`} className="btn-secondary mt-4 w-fit">
                جزئیات سبد
              </Link>
            )}
          </div>
        </section>
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
