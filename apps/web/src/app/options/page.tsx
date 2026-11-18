'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, api, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';
import { OptionsTableRow, OptionsValueTable } from '@/components/OptionsValueTable';

type Payload = {
  disclaimerFa: string;
  inflationPct: number | null;
  /** زمان آخرین اینجست اختیار معامله (ISO) */
  updatedAt?: string | null;
  items: OptionsTableRow[];
};

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fa-IR', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OptionsMarketPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [watching, setWatching] = useState(false);

  function loadOptions() {
    return api<Payload>('/market/option-value')
      .then((payload) => {
        setData(payload);
        setAllowed(true);
        setError('');
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          setAllowed(false);
          setData(null);
          return;
        }
        setError(e instanceof Error ? e.message : 'بارگذاری بازار اختیار ناموفق بود.');
      });
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    let cancel = false;
    api<{ role?: UserRole; optionsMarketAccess?: boolean } | null>('/users/me')
      .then((u) => {
        if (cancel || !u) return;
        const admin = u.role === 'ADMIN' || getUserRole() === 'ADMIN';
        if (u.role) setUserRole(u.role);
        setIsAdmin(admin);
        if (!admin && u.optionsMarketAccess === false) {
          setAllowed(false);
          return;
        }
        setAllowed(true);
        return loadOptions();
      })
      .catch(() => {
        if (cancel || !getToken()) return;
        setIsAdmin(getUserRole() === 'ADMIN');
        setAllowed(true);
        return loadOptions();
      });
    return () => {
      cancel = true;
    };
  }, [router]);

  useEffect(() => {
    if (!watching) return;
    let stop = false;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 45) {
        setWatching(false);
        setNotice('به‌روزرسانی هنوز در جریان است. کمی بعد صفحه را دوباره باز کنید.');
        return;
      }
      api<{ running: boolean; messageFa: string; error: boolean }>('/market/options/refresh-status')
        .then((status) => {
          if (stop || status.running || !status.messageFa) return;
          setWatching(false);
          if (status.error) {
            setError(status.messageFa);
            return;
          }
          setNotice(status.messageFa);
          return loadOptions();
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [watching]);

  async function refreshNow() {
    setRefreshing(true);
    setNotice('');
    setError('');
    try {
      const res = await api<{ started?: boolean; messageFa?: string }>('/market/options/refresh', {
        method: 'POST',
      });
      setNotice(res.messageFa || 'به‌روزرسانی اختیار شروع شد.');
      if (res.started) setWatching(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'به‌روزرسانی اختیار معامله ناموفق بود.';
      setError(
        /failed to fetch|networkerror|load failed|502/i.test(raw)
          ? 'ارتباط با سرور هنگام به‌روزرسانی قطع شد. متن خطا در بخش خطاهای مشاهده‌شدهٔ تنظیمات ادمین می‌ماند.'
          : raw,
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">بازار اختیار معامله</h1>
          <Link href="/options/calculator" className="mt-2 inline-block text-sm text-gold-700 hover:underline">
            ماشین‌حساب استراتژی اختیار
          </Link>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isAdmin && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void refreshNow()}
              disabled={refreshing || watching}
            >
              {watching ? 'در پس‌زمینه در جریان است' : refreshing ? 'در حال ارسال...' : 'به‌روزرسانی لحظه‌ای'}
            </button>
          )}
          {data?.updatedAt && (
            <p className="text-xs text-navy-800/60">
              آخرین به‌روزرسانی: {formatUpdatedAt(data.updatedAt)}
            </p>
          )}
        </div>
      </div>

      {allowed === false && (
        <p className="text-sm text-navy-800/70">دسترسی بازار اختیار معامله برای حساب شما فعال نیست.</p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-navy-800/80">{notice}</p>}

      {allowed !== false && (
        <OptionsValueTable items={data?.items ?? null} loading={!data && !error} />
      )}
    </div>
  );
}
