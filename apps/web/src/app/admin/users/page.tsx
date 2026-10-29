'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, formatRial, getToken } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { formatShamsiDate } from '@/lib/shamsi-date';

type AppUser = {
  id: string;
  email: string;
  name?: string | null;
  role?: 'ADMIN' | 'USER' | 'RESELLER';
  createdAt: string;
  isActive: boolean;
  referralCode?: string | null;
  referralActive?: boolean;
  discountPct?: number;
  optionsMarketAccess?: boolean;
  aiPortfolioEnabled?: boolean;
  llmEnabled?: boolean;
  clientCount?: number;
  mobilePhone?: string | null;
  telegramLinked?: boolean;
  telegramUsername?: string | null;
};

type EditMode = 'edit' | 'password' | 'role' | 'referral' | null;

const ROLE_FA = {
  ADMIN: 'ادمین',
  USER: 'کاربر عادی',
  RESELLER: 'Reseller',
} as const;

type ResellerReport = {
  rows: Array<{
    id: string;
    email: string;
    name: string | null;
    isActive: boolean;
    referralCode: string | null;
    referralActive: boolean;
    discountPct: number;
    userCount: number;
    chargeUserCount: number;
    chargeCount: number;
    creditRial: number;
    paidRial: number;
  }>;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const toast = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AppUser | null>(null);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const [editForm, setEditForm] = useState({ email: '', name: '' });
  const [newPassword, setNewPassword] = useState('');
  const [roleForm, setRoleForm] = useState({ role: 'USER' as 'ADMIN' | 'USER' | 'RESELLER', discountPct: '0' });
  const [referralForm, setReferralForm] = useState({ code: '', active: true, discountPct: '0' });
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [report, setReport] = useState<ResellerReport | null>(null);

  async function loadUsers() {
    const list = await api<AppUser[]>('/users');
    setUsers(list);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
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
  }

  function openPassword(user: AppUser) {
    setSelected(user);
    setEditMode('password');
    setNewPassword('');
  }

  function closePanel() {
    setSelected(null);
    setEditMode(null);
    setNewPassword('');
  }

  async function addUser(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
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
      toast.success('کاربر جدید ایجاد شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    try {
      await api(`/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          email: editForm.email.trim(),
          name: editForm.name.trim() || undefined,
        }),
      });
      await loadUsers();
      toast.success('اطلاعات کاربر به‌روز شد.');
      closePanel();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    try {
      await api(`/users/${selected.id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword }),
      });
      toast.success('رمز عبور تغییر کرد.');
      closePanel();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleAi(user: AppUser, field: 'portfolio' | 'llm') {
    setLoading(true);
    try {
      await api(`/users/${user.id}/ai-access`, {
        method: 'PATCH',
        body: JSON.stringify(
          field === 'portfolio'
            ? { portfolio: !user.aiPortfolioEnabled }
            : { llm: !user.llmEnabled },
        ),
      });
      await loadUsers();
      toast.success(
        field === 'portfolio'
          ? user.aiPortfolioEnabled
            ? 'پیشنهاد سبد با هوش مصنوعی خاموش شد.'
            : 'پیشنهاد سبد با هوش مصنوعی روشن شد.'
          : user.llmEnabled
            ? 'استفاده از مدل زبانی خاموش شد.'
            : 'استفاده از مدل زبانی روشن شد.',
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleOptionsAccess(user: AppUser) {
    setLoading(true);
    try {
      await api(`/users/${user.id}/options-access`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !user.optionsMarketAccess }),
      });
      await loadUsers();
      toast.success(user.optionsMarketAccess ? 'دسترسی بازار اختیار بسته شد.' : 'دسترسی بازار اختیار باز شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function unlinkTelegram(user: AppUser) {
    if (!confirm(`اتصال «${user.name || user.email}» به ربات تلگرام قطع شود؟`)) return;
    setLoading(true);
    try {
      await api(`/telegram/links/${user.id}/unlink`, { method: 'POST' });
      await loadUsers();
      toast.success('اتصال این کاربر به ربات قطع شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openRole(user: AppUser) {
    setSelected(user);
    setEditMode('role');
    setRoleForm({ role: user.role && user.role !== 'ADMIN' ? user.role : 'USER', discountPct: String(user.discountPct ?? 0) });
  }

  function openReferral(user: AppUser) {
    setSelected(user);
    setEditMode('referral');
    setReferralForm({
      code: user.referralCode ?? '',
      active: user.referralActive !== false,
      discountPct: String(user.discountPct ?? 0),
    });
  }

  async function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    try {
      await api(`/users/${selected.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({
          role: roleForm.role,
          ...(roleForm.role === 'RESELLER' ? { discountPct: Number(roleForm.discountPct) } : {}),
        }),
      });
      await loadUsers();
      toast.success('نقش کاربر ذخیره شد. برای دیدن منوی تازه باید دوباره وارد شود.');
      closePanel();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveReferral(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    try {
      await api(`/users/${selected.id}/referral`, {
        method: 'PATCH',
        body: JSON.stringify({
          referralCode: referralForm.code.trim(),
          referralActive: referralForm.active,
          discountPct: Number(referralForm.discountPct),
        }),
      });
      await loadUsers();
      toast.success('کد معرف ذخیره شد.');
      closePanel();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadReport(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
      const query = params.toString();
      setReport(await api<ResellerReport>(`/users/reseller/report${query ? `?${query}` : ''}`));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(user: AppUser) {
    const next = !user.isActive;
    const label = next ? 'فعال' : 'غیرفعال';
    if (!confirm(`کاربر «${user.name || user.email}» ${label} شود؟`)) return;
    setLoading(true);
    try {
      await api(`/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      await loadUsers();
      toast.success(`کاربر ${label} شد.`);
      if (selected?.id === user.id) closePanel();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">مدیریت کاربران</h1>
        <p className="mt-2 text-navy-800/70">
          ایجاد کاربر، تغییر نقش به ادمین یا Reseller، کد معرف، غیرفعال‌سازی و تغییر رمز
        </p>
      </div>

      <form onSubmit={(e) => void loadReport(e)} className="card space-y-4">
        <h2 className="text-lg font-semibold">گزارش Resellerها</h2>
        <p className="text-sm leading-7 text-navy-800/70">
          تعداد کاربران هر Reseller، و در بازهٔ انتخاب‌شده چند نفر با کد معرف کیف پول را شارژ کرده‌اند.
        </p>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            از
            <input className="input mt-1" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} dir="ltr" />
          </label>
          <label className="text-sm">
            تا
            <input className="input mt-1" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} dir="ltr" />
          </label>
          <button type="submit" className="btn-secondary mt-6 w-fit" disabled={loading}>
            نمایش گزارش
          </button>
        </div>
        {report && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-navy-800/55">
                  <th className="py-2 text-start">Reseller</th>
                  <th className="py-2 text-start">کد</th>
                  <th className="py-2 text-start">کاربران</th>
                  <th className="py-2 text-start">شارژکنندگان</th>
                  <th className="py-2 text-start">مبلغ کیف پول</th>
                  <th className="py-2 text-start">مبلغ پرداختی</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.id} className="border-t border-navy-900/10">
                    <td className="py-2">{row.name || row.email}</td>
                    <td className="py-2" dir="ltr">
                      {row.referralCode ?? '—'}
                      {!row.referralActive ? ' (خاموش)' : ''}
                    </td>
                    <td className="py-2">{row.userCount.toLocaleString('fa-IR')}</td>
                    <td className="py-2">{row.chargeUserCount.toLocaleString('fa-IR')}</td>
                    <td className="py-2">{formatRial(row.creditRial)}</td>
                    <td className="py-2">{formatRial(row.paidRial)}</td>
                  </tr>
                ))}
                {report.rows.length === 0 && (
                  <tr>
                    <td className="py-3 text-navy-800/50" colSpan={6}>
                      Resellerی ثبت نشده است.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </form>

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">نام نمایشی</th>
              <th className="px-4 py-3 text-start font-medium">نقش</th>
              <th className="px-4 py-3 text-start font-medium">نام کاربری</th>
              <th className="px-4 py-3 text-start font-medium">تاریخ ایجاد</th>
              <th className="px-4 py-3 text-start font-medium">وضعیت</th>
              <th className="px-4 py-3 text-start font-medium">ربات تلگرام</th>
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
                <td className="px-4 py-3">{ROLE_FA[u.role ?? 'USER']}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 text-navy-800/70">
                  {formatShamsiDate(u.createdAt)}
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
                  {u.telegramLinked ? (
                    <span className="text-emerald-800">
                      وصل
                      {u.telegramUsername ? ` (@${u.telegramUsername})` : ''}
                      {u.mobilePhone ? ` — ${u.mobilePhone}` : ''}
                    </span>
                  ) : (
                    <span className="text-navy-800/50">وصل نیست</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {u.role !== 'ADMIN' && (
                      <button
                        type="button"
                        className="text-xs text-navy-800 hover:underline"
                        onClick={() => void toggleAi(u, 'portfolio')}
                      >
                        {u.aiPortfolioEnabled === false ? 'روشن کردن پیشنهاد سبد' : 'خاموش کردن پیشنهاد سبد'}
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button
                        type="button"
                        className="text-xs text-navy-800 hover:underline"
                        onClick={() => void toggleAi(u, 'llm')}
                      >
                        {u.llmEnabled === false ? 'روشن کردن مدل زبانی' : 'خاموش کردن مدل زبانی'}
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button
                        type="button"
                        className="text-xs text-navy-800 hover:underline"
                        onClick={() => void toggleOptionsAccess(u)}
                      >
                        {u.optionsMarketAccess ? 'بستن اختیار' : 'دسترسی اختیار'}
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button
                        type="button"
                        className="text-xs text-navy-800 hover:underline"
                        onClick={() => openEdit(u)}
                      >
                        ویرایش
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button
                        type="button"
                        className="text-xs text-navy-800 hover:underline"
                        onClick={() => openPassword(u)}
                      >
                        تغییر رمز
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
                      <button type="button" className="text-xs text-navy-800 hover:underline" onClick={() => openRole(u)}>
                        تغییر نقش
                      </button>
                    )}
                    {u.role === 'RESELLER' && (
                      <button type="button" className="text-xs text-navy-800 hover:underline" onClick={() => openReferral(u)}>
                        کد معرف
                      </button>
                    )}
                    {u.role !== 'ADMIN' && (
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
                    )}
                    {u.telegramLinked && (
                      <button
                        type="button"
                        className="text-xs text-red-700 hover:underline"
                        onClick={() => unlinkTelegram(u)}
                        disabled={loading}
                      >
                        قطع اتصال ربات
                      </button>
                    )}
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

      {selected && editMode === 'role' && (
        <form onSubmit={saveRole} className="card grid max-w-xl gap-4">
          <h2 className="text-lg font-semibold">تغییر نقش — {selected.name || selected.email}</h2>
          <div>
            <label className="label">نقش</label>
            <select
              className="input"
              value={roleForm.role}
              onChange={(e) => setRoleForm({ ...roleForm, role: e.target.value as 'ADMIN' | 'USER' | 'RESELLER' })}
            >
              <option value="USER">کاربر عادی</option>
              <option value="RESELLER">Reseller</option>
              <option value="ADMIN">ادمین</option>
            </select>
          </div>
          {roleForm.role === 'RESELLER' && (
            <div>
              <label className="label">درصد تخفیف کد معرف</label>
              <input
                className="input"
                inputMode="numeric"
                value={roleForm.discountPct}
                onChange={(e) => setRoleForm({ ...roleForm, discountPct: e.target.value.replace(/[^\d]/g, '') })}
                required
              />
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              ذخیره نقش
            </button>
            <button type="button" className="btn-secondary" onClick={closePanel}>
              انصراف
            </button>
          </div>
        </form>
      )}

      {selected && editMode === 'referral' && (
        <form onSubmit={saveReferral} className="card grid max-w-xl gap-4">
          <h2 className="text-lg font-semibold">کد معرف — {selected.name || selected.email}</h2>
          <div>
            <label className="label">کد</label>
            <input
              className="input"
              dir="ltr"
              value={referralForm.code}
              onChange={(e) => setReferralForm({ ...referralForm, code: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">درصد تخفیف</label>
            <input
              className="input"
              inputMode="numeric"
              value={referralForm.discountPct}
              onChange={(e) => setReferralForm({ ...referralForm, discountPct: e.target.value.replace(/[^\d]/g, '') })}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={referralForm.active}
              onChange={(e) => setReferralForm({ ...referralForm, active: e.target.checked })}
            />
            کد معرف فعال باشد
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={loading}>
              ذخیره کد
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
