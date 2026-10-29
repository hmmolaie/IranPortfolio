'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getUserRole, setUserRole, UserRole } from '@/lib/api';
import { OptionsTableRow, OptionsValueTable } from '@/components/OptionsValueTable';

type Payload = {
  disclaimerFa: string;
  inflationPct: number | null;
  items: OptionsTableRow[];
};

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
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    api<{ role?: UserRole; optionsMarketAccess?: boolean }>('/users/me')
      .then((u) => {
        const admin = u.role === 'ADMIN' || getUserRole() === 'ADMIN';
        if (u.role) setUserRole(u.role);
        setIsAdmin(admin);
        const ok = admin || Boolean(u.optionsMarketAccess);
        setAllowed(ok);
        if (ok) return loadOptions();
      })
      .catch(() => setAllowed(false));
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
        <p className="mt-2 text-navy-800/70">
          فقط اختیارهای فعال که سررسیدشان نگذشته و سودشان نسبت به قیمت دارایی پایه قابل توجه است. سود واقعی، همین سود را پس از تورمِ روزهای مانده تا سررسید نشان می‌دهد.
          {data?.inflationPct != null
            ? ` نرخ تورم سالانه: ${data.inflationPct.toLocaleString('fa-IR')}٪.`
            : data
              ? ' نرخ تورم سالانه در اقتصاد ایران ثبت نشده است.'
              : ''}
        </p>
        </div>
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
      </div>

      {allowed === false && (
        <p className="text-sm text-navy-800/70">دسترسی بازار اختیار معامله برای حساب شما فعال نیست.</p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-navy-800/80">{notice}</p>}
      {data && <p className="text-sm text-navy-800/60">{data.disclaimerFa}</p>}

      {allowed !== false && (
        <OptionsValueTable items={data?.items ?? null} loading={!data && !error} />
      )}
    </div>
  );
}
