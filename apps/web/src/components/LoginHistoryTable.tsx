'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatShamsiDateTime } from '@/lib/shamsi-date';
import {
  describeDevice,
  formatDurationFa,
  sessionUserLabel,
  type SessionUser,
} from '@/lib/session-format';

type HistoryRow = {
  id: string;
  user: SessionUser;
  ip: string | null;
  userAgent: string | null;
  method: string;
  loginAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  status: 'online' | 'logout' | 'kicked' | 'idle';
  durationSec: number;
};

type HistoryPage = { total: number; page: number; pageSize: number; items: HistoryRow[] };

const PAGE_SIZE = 25;

const STATUS_FA: Record<HistoryRow['status'], { label: string; cls: string }> = {
  online: { label: 'داخل سایت', cls: 'bg-emerald-50 text-emerald-700' },
  logout: { label: 'خروج', cls: 'bg-navy-50 text-navy-800' },
  kicked: { label: 'اخراج توسط ادمین', cls: 'bg-red-50 text-red-700' },
  idle: { label: 'بدون خروج', cls: 'bg-gold-400/15 text-navy-800' },
};

/** سوابق ورود: هر ورود، از کدام آی‌پی، چه زمانی و چه مدت */
export function LoginHistoryTable({ users }: { users: SessionUser[] }) {
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMsg('');
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (userId) qs.set('userId', userId);
    api<HistoryPage>(`/admin/sessions/history?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setMsg((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">سوابق ورود به سیستم</h2>
          <p className="mt-1 text-sm leading-7 text-navy-800/70">
            مدت استفاده از زمان ورود تا خروج یا آخرین فعالیت کاربر حساب می‌شود. سوابق ۱۸۰ روز نگه داشته می‌شود.
          </p>
        </div>
        <div>
          <label className="label">کاربر</label>
          <select
            className="input min-w-[14rem]"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همهٔ کاربران</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {sessionUserLabel(u)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {msg && <p className="text-sm text-red-700">{msg}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-navy-900/10 text-navy-800/60">
              <th className="px-2 py-2 text-start font-medium">کاربر</th>
              <th className="px-2 py-2 text-start font-medium">زمان ورود</th>
              <th className="px-2 py-2 text-start font-medium">آخرین فعالیت / خروج</th>
              <th className="px-2 py-2 text-start font-medium">مدت استفاده</th>
              <th className="px-2 py-2 text-start font-medium">آی‌پی</th>
              <th className="px-2 py-2 text-start font-medium">دستگاه</th>
              <th className="px-2 py-2 text-start font-medium">وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr key={row.id} className="border-b border-navy-900/5">
                <td className="px-2 py-2">{sessionUserLabel(row.user)}</td>
                <td className="px-2 py-2 whitespace-nowrap">{formatShamsiDateTime(row.loginAt)}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {formatShamsiDateTime(row.endedAt ?? row.lastSeenAt)}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{formatDurationFa(row.durationSec)}</td>
                <td className="px-2 py-2" dir="ltr">
                  {row.ip || '—'}
                </td>
                <td className="px-2 py-2 text-navy-800/70">
                  {describeDevice(row.userAgent)}
                  {row.method === 'webauthn' && <span className="ms-1 text-xs">(اثر انگشت/چهره)</span>}
                </td>
                <td className="px-2 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_FA[row.status]?.cls ?? ''}`}>
                    {STATUS_FA[row.status]?.label ?? row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="py-3 text-sm text-navy-800/60">در حال بارگذاری...</p>}
        {!loading && data && data.items.length === 0 && (
          <p className="py-3 text-sm text-navy-800/60">سابقهٔ ورودی ثبت نشده است.</p>
        )}
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            قبلی
          </button>
          <span className="text-sm text-navy-800/70">
            صفحه {page.toLocaleString('fa-IR')} از {totalPages.toLocaleString('fa-IR')}
          </span>
          <button
            type="button"
            className="btn-secondary !px-3 !py-1.5 text-xs"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            بعدی
          </button>
        </div>
      )}
    </section>
  );
}
