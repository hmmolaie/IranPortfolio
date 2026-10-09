'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken, getUserRole } from '@/lib/api';
import { formatShamsiDate } from '@/lib/shamsi-date';

type Sums = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costRial: number;
  calls: number;
};

type DailyBar = {
  dateKey: string;
  totalTokens: number;
  costRial: number;
};

type UsageUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  limitTokens: number;
  hasOwnQuota: boolean;
} & Sums;

type UsageSection = {
  section: string;
  labelFa: string;
  daily: DailyBar[];
} & Sums;

type Report = {
  config: {
    promptRialPer1k: number;
    completionRialPer1k: number;
    defaultQuotaTokens: number;
  };
  users: UsageUser[];
  sections: UsageSection[];
};

export default function AiCostPage() {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [promptRate, setPromptRate] = useState('0');
  const [completionRate, setCompletionRate] = useState('0');
  const [defaultQuota, setDefaultQuota] = useState('0');
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    return api<Report>('/ai-usage/admin')
      .then((data) => {
        setReport(data);
        setPromptRate(String(data.config.promptRialPer1k));
        setCompletionRate(String(data.config.completionRialPer1k));
        setDefaultQuota(String(data.config.defaultQuotaTokens));
        setQuotaDraft(
          Object.fromEntries(data.users.map((user) => [user.id, String(user.limitTokens)])),
        );
        setError('');
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'ADMIN') {
      router.replace('/dashboard');
      return;
    }
    void load();
  }, [load, router]);

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      await api('/ai-usage/config', {
        method: 'PUT',
        body: JSON.stringify({
          promptRialPer1k: Number(promptRate) || 0,
          completionRialPer1k: Number(completionRate) || 0,
          defaultQuotaTokens: Number(defaultQuota) || 0,
        }),
      });
      setNotice('نرخ و سهمیهٔ پیش‌فرض ذخیره شد.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveQuota(userId: string) {
    setBusy(true);
    setNotice('');
    try {
      await api(`/ai-usage/users/${userId}/quota`, {
        method: 'PUT',
        body: JSON.stringify({ limitTokens: Number(quotaDraft[userId]) || 0 }),
      });
      setNotice('سهمیهٔ این کاربر ذخیره شد.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetCounters() {
    if (!window.confirm('شمارندهٔ توکن و هزینه از این لحظه صفر می‌شود. سوابق متنی، سهمیه‌ها و نرخ‌ها می‌مانند. ادامه می‌دهید؟')) {
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api('/ai-usage/reset', { method: 'POST' });
      setNotice('شمارنده‌ها از این لحظه صفر شد. سوابق در صفحهٔ سوابق هوش مصنوعی می‌ماند.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">هزینه هوش مصنوعی</h1>
          <p className="mt-2 text-navy-800/70">
            توکن و هزینهٔ هر کاربر و هر بخش، از آخرین ریست. صفر در سهمیه یعنی بدون سقف.
          </p>
        </div>
        <button type="button" className="btn-secondary text-red-700" disabled={busy} onClick={() => void resetCounters()}>
          صفر کردن شمارنده‌ها
        </button>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      <form className="card grid gap-4 sm:grid-cols-3" onSubmit={(event) => void saveConfig(event)}>
        <label className="block">
          <span className="label">ریال هر ۱۰۰۰ توکن ورودی</span>
          <input className="input" inputMode="decimal" value={promptRate} onChange={(e) => setPromptRate(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">ریال هر ۱۰۰۰ توکن خروجی</span>
          <input
            className="input"
            inputMode="decimal"
            value={completionRate}
            onChange={(e) => setCompletionRate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">سهمیهٔ پیش‌فرض توکن</span>
          <input className="input" inputMode="numeric" value={defaultQuota} onChange={(e) => setDefaultQuota(e.target.value)} />
        </label>
        <div className="sm:col-span-3">
          <button className="btn-primary" type="submit" disabled={busy}>
            ذخیره نرخ و سهمیهٔ پیش‌فرض
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto">
        <h2 className="mb-4 text-lg font-bold">کاربران</h2>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-navy-800/55">
              <th className="py-2 text-start">کاربر</th>
              <th className="py-2 text-start">توکن</th>
              <th className="py-2 text-start">هزینه</th>
              <th className="py-2 text-start">دفعات</th>
              <th className="py-2 text-start">سهمیه توکن</th>
            </tr>
          </thead>
          <tbody>
            {(report?.users ?? []).map((user) => (
              <tr key={user.id} className="border-t border-navy-900/10">
                <td className="py-2">
                  <div>{user.name?.trim() || user.email}</div>
                  <div className="text-xs text-navy-800/50" dir="ltr">
                    {user.email}
                  </div>
                </td>
                <td className="py-2">{formatNum(user.totalTokens)}</td>
                <td className="py-2">{formatRial(user.costRial)}</td>
                <td className="py-2">{formatNum(user.calls)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="input !w-32"
                      inputMode="numeric"
                      value={quotaDraft[user.id] ?? ''}
                      onChange={(e) => setQuotaDraft((prev) => ({ ...prev, [user.id]: e.target.value }))}
                    />
                    <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void saveQuota(user.id)}>
                      ذخیره
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-navy-800/45">
                    {user.hasOwnQuota ? 'سهمیهٔ اختصاصی' : 'سهمیهٔ پیش‌فرض'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold">بخش‌های سیستم</h2>
        <p className="text-sm text-navy-800/60">نمودار هر بخش، توکن چهارده روز اخیر به وقت تهران است.</p>
        {(report?.sections ?? []).length === 0 && (
          <p className="text-sm text-navy-800/60">هنوز مصرفی ثبت نشده است.</p>
        )}
        {(report?.sections ?? []).map((section) => (
          <section key={section.section} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-bold">{section.labelFa}</h3>
              <p className="text-sm text-navy-800/70">
                {formatNum(section.totalTokens)} توکن · {formatRial(section.costRial)} · {formatNum(section.calls)} بار
              </p>
            </div>
            <DailyBars daily={section.daily} />
          </section>
        ))}
      </div>
    </div>
  );
}

function DailyBars({ daily }: { daily: DailyBar[] }) {
  const max = Math.max(1, ...daily.map((day) => day.totalTokens));
  return (
    <div className="flex items-end gap-1" style={{ height: '7rem' }}>
      {daily.map((day) => {
        const height = day.totalTokens > 0 ? Math.max(6, Math.round((day.totalTokens / max) * 100)) : 0;
        return (
          <div key={day.dateKey} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-t bg-navy-800/80"
              style={{ height: `${height}%` }}
              title={`${formatShamsiDate(day.dateKey, 'short')} — ${formatNum(day.totalTokens)} توکن`}
            />
            <span className="w-full truncate text-center text-[10px] text-navy-800/45">
              {formatShamsiDate(day.dateKey, 'short')}
            </span>
          </div>
        );
      })}
    </div>
  );
}
