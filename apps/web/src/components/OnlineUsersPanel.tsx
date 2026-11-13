'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatShamsiDateTime } from '@/lib/shamsi-date';
import {
  describeDevice,
  formatDurationFa,
  sessionUserLabel,
  type SessionUser,
} from '@/lib/session-format';

type OnlineSession = {
  id: string;
  user: SessionUser;
  ip: string | null;
  userAgent: string | null;
  method: string;
  loginAt: string;
  lastSeenAt: string;
  durationSec: number;
};

const REFRESH_MS = 30_000;

/** کاربرانی که الان داخل سایت‌اند، با امکان اخراج؛ فقط ادمین */
export function OnlineUsersPanel() {
  const [rows, setRows] = useState<OnlineSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [kickingId, setKickingId] = useState<string | null>(null);
  // مدت حضور بین دو بار خواندن هم جلو برود
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setRows(await api<OnlineSession[]>('/admin/sessions/online'));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const poll = window.setInterval(() => load().catch(() => undefined), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  async function kick(row: OnlineSession) {
    if (!confirm(`«${sessionUserLabel(row.user)}» از سایت اخراج شود؟`)) return;
    setKickingId(row.id);
    setMsg('');
    try {
      await api(`/admin/sessions/${row.id}/kick`, { method: 'POST' });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setMsg(`${sessionUserLabel(row.user)} از سایت خارج شد.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setKickingId(null);
    }
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">کاربران آنلاین</h2>
          <p className="mt-1 text-sm leading-7 text-navy-800/70">
            کاربرانی که وارد شده‌اند و در ۳ دقیقهٔ اخیر داخل سایت فعال بوده‌اند. با اخراج، نشست همان لحظه بسته می‌شود
            و کاربر باید دوباره وارد شود.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => load()} disabled={loading}>
          تازه‌سازی
        </button>
      </div>

      {msg && <p className="text-sm">{msg}</p>}

      {loading ? (
        <p className="text-sm text-navy-800/60">در حال بارگذاری...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-navy-800/60">الان کاربری داخل سایت نیست.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-navy-900/10 text-navy-800/60">
                <th className="px-2 py-2 text-start font-medium">کاربر</th>
                <th className="px-2 py-2 text-start font-medium">آی‌پی</th>
                <th className="px-2 py-2 text-start font-medium">دستگاه</th>
                <th className="px-2 py-2 text-start font-medium">زمان ورود</th>
                <th className="px-2 py-2 text-start font-medium">مدت حضور</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-navy-900/5">
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                      {sessionUserLabel(row.user)}
                    </span>
                  </td>
                  <td className="px-2 py-2" dir="ltr">
                    {row.ip || '—'}
                  </td>
                  <td className="px-2 py-2 text-navy-800/70">
                    {describeDevice(row.userAgent)}
                    {row.method === 'webauthn' && <span className="ms-1 text-xs">(اثر انگشت/چهره)</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">{formatShamsiDateTime(row.loginAt)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {formatDurationFa((now - new Date(row.loginAt).getTime()) / 1000)}
                  </td>
                  <td className="px-2 py-2 text-end">
                    <button
                      type="button"
                      className="btn-secondary !px-3 !py-1.5 text-xs text-red-700 hover:bg-red-50"
                      disabled={kickingId === row.id}
                      onClick={() => kick(row)}
                    >
                      {kickingId === row.id ? 'در حال اخراج...' : 'اخراج'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
