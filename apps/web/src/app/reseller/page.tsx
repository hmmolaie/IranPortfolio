'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatRial, getToken, getUserRole } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { formatShamsiDate } from '@/lib/shamsi-date';

type MineUser = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  isActive: boolean;
  optionsMarketAccess: boolean;
};

type ReportRow = {
  referralCode: string | null;
  referralActive: boolean;
  discountPct: number;
  userCount: number;
  chargeUserCount: number;
  chargeCount: number;
  creditRial: number;
  paidRial: number;
};

export default function ResellerPage() {
  const router = useRouter();
  const toast = useToast();
  const [users, setUsers] = useState<MineUser[]>([]);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [passwordFor, setPasswordFor] = useState<MineUser | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<ReportRow | null>(null);

  async function load() {
    setUsers(await api<MineUser[]>('/users/mine'));
  }

  async function loadReport(e?: FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    const data = await api<{ rows: ReportRow[] }>(`/users/reseller/report${query ? `?${query}` : ''}`);
    setReport(data.rows[0] ?? null);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'RESELLER') {
      router.replace('/dashboard');
      return;
    }
    load().catch((err) => toast.error((err as Error).message));
    loadReport().catch((err) => toast.error((err as Error).message));
  }, [router]);

  async function toggleOptions(user: MineUser) {
    setBusy(true);
    try {
      await api(`/users/mine/${user.id}/options-access`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !user.optionsMarketAccess }),
      });
      await load();
      toast.success(user.optionsMarketAccess ? 'دسترسی بازار اختیار بسته شد.' : 'دسترسی بازار اختیار باز شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/users/mine', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          name: form.name.trim() || undefined,
        }),
      });
      setForm({ email: '', password: '', name: '' });
      await load();
      await loadReport();
      toast.success('کاربر ساخته شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!passwordFor) return;
    setBusy(true);
    try {
      await api(`/users/mine/${passwordFor.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setPasswordFor(null);
      toast.success('رمز این کاربر عوض شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">کاربران من</h1>
        <p className="mt-2 text-navy-800/70">ساخت کاربر عادی و تغییر رمز همان کاربران. بقیهٔ تنظیمات سیستم در اختیار مدیر است.</p>
      </div>

      {report && (
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">کد معرف و شارژ</h2>
          <p className="text-sm leading-7">
            کد: <span dir="ltr">{report.referralCode ?? '—'}</span>
            {report.referralActive ? '' : ' (غیرفعال)'}
            {' · '}
            تخفیف {report.discountPct.toLocaleString('fa-IR')} درصد
            {' · '}
            کاربران {report.userCount.toLocaleString('fa-IR')}
          </p>
          <form onSubmit={(e) => void loadReport(e)} className="flex flex-wrap gap-3">
            <label className="text-sm">
              از
              <input className="input mt-1" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              تا
              <input className="input mt-1" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button type="submit" className="btn-secondary mt-6" disabled={busy}>
              این بازه
            </button>
          </form>
          <p className="text-sm leading-7 text-navy-800/80">
            در این بازه {report.chargeUserCount.toLocaleString('fa-IR')} کاربر با کد معرف شارژ کرده‌اند. مبلغ کیف پول{' '}
            {formatRial(report.creditRial)} و مبلغ پرداختی {formatRial(report.paidRial)}.
          </p>
        </section>
      )}

      <form onSubmit={createUser} className="card grid max-w-xl gap-4">
        <h2 className="text-lg font-semibold">کاربر جدید</h2>
        <div>
          <label className="label">نام کاربری</label>
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div>
          <label className="label">رمز عبور</label>
          <input
            className="input"
            type="password"
            minLength={6}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="label">نام نمایشی</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <button type="submit" className="btn-primary w-fit" disabled={busy}>
          ساخت کاربر
        </button>
      </form>

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start">نام</th>
              <th className="px-4 py-3 text-start">نام کاربری</th>
              <th className="px-4 py-3 text-start">تاریخ</th>
              <th className="px-4 py-3 text-start">وضعیت</th>
              <th className="px-4 py-3 text-start">بازار اختیار</th>
              <th className="px-4 py-3 text-start">رمز</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-navy-900/5">
                <td className="px-4 py-3">{user.name || '—'}</td>
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">{formatShamsiDate(user.createdAt)}</td>
                <td className="px-4 py-3">{user.isActive ? 'فعال' : 'غیرفعال'}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-xs text-navy-800 underline"
                    disabled={busy}
                    onClick={() => void toggleOptions(user)}
                  >
                    {user.optionsMarketAccess ? 'بستن' : 'دادن دسترسی'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-xs text-navy-800 underline"
                    onClick={() => {
                      setPasswordFor(user);
                      setPassword('');
                    }}
                  >
                    تغییر رمز
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-navy-800/50" colSpan={6}>
                  هنوز کاربری نساخته‌اید.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {passwordFor && (
        <form onSubmit={savePassword} className="card grid max-w-xl gap-4">
          <h2 className="text-lg font-semibold">رمز {passwordFor.name || passwordFor.email}</h2>
          <input
            className="input"
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              ذخیره رمز
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPasswordFor(null)}>
              انصراف
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
