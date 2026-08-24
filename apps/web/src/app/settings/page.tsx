'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState({ name: '', riskTolerance: 5, horizonMonths: 12, notes: '' });
  const [llm, setLlm] = useState({
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiToken: '',
    usePlatformFallback: true,
    hasToken: false,
  });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{
      name?: string;
      profile?: { riskTolerance: number; horizonMonths: number; notes?: string | null };
    }>('/users/me').then((u) => {
      setProfile({
        name: u.name ?? '',
        riskTolerance: u.profile?.riskTolerance ?? 5,
        horizonMonths: u.profile?.horizonMonths ?? 12,
        notes: u.profile?.notes ?? '',
      });
    });
    api<{
      baseUrl: string;
      model: string;
      usePlatformFallback: boolean;
      hasToken: boolean;
    } | null>('/llm/settings').then((s) => {
      if (s) {
        setLlm((prev) => ({
          ...prev,
          baseUrl: s.baseUrl,
          model: s.model,
          usePlatformFallback: s.usePlatformFallback,
          hasToken: s.hasToken,
        }));
      }
    });
  }, [router]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    await api('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        name: profile.name,
        riskTolerance: Number(profile.riskTolerance),
        horizonMonths: Number(profile.horizonMonths),
        notes: profile.notes,
      }),
    });
    setMsg('پروفایل ذخیره شد.');
  }

  async function saveLlm(e: FormEvent) {
    e.preventDefault();
    await api('/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({
        baseUrl: llm.baseUrl,
        model: llm.model,
        usePlatformFallback: llm.usePlatformFallback,
        ...(llm.apiToken ? { apiToken: llm.apiToken } : {}),
      }),
    });
    setMsg('تنظیمات LLM ذخیره شد.');
    setLlm((prev) => ({ ...prev, apiToken: '', hasToken: prev.hasToken || Boolean(llm.apiToken) }));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">تنظیمات</h1>
        <p className="mt-2 text-navy-800/70">پروفایل و اتصال به مدل زبانی سازگار با ChatGPT</p>
      </div>
      {msg && <p className="text-sm text-navy-800">{msg}</p>}

      <form onSubmit={saveProfile} className="card grid max-w-2xl gap-4">
        <h2 className="text-lg font-semibold">پروفایل</h2>
        <div>
          <label className="label">نام</label>
          <input
            className="input"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">تحمل ریسک (۱–۱۰)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            value={profile.riskTolerance}
            onChange={(e) => setProfile({ ...profile, riskTolerance: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="label">افق سرمایه‌گذاری (ماه)</label>
          <input
            className="input"
            type="number"
            min={1}
            value={profile.horizonMonths}
            onChange={(e) => setProfile({ ...profile, horizonMonths: Number(e.target.value) })}
          />
        </div>
        <button className="btn-primary w-fit">ذخیره پروفایل</button>
      </form>

      <form onSubmit={saveLlm} className="card grid max-w-2xl gap-4">
        <h2 className="text-lg font-semibold">API مدل زبانی</h2>
        <p className="text-sm text-navy-800/60">
          آدرس پایه سازگار با OpenAI (مثل api.openai.com یا هر پروکسی سازگار) و توکن را وارد کنید.
          {llm.hasToken ? ' توکن قبلاً ذخیره شده است.' : ''}
        </p>
        <div>
          <label className="label">Base URL</label>
          <input
            className="input"
            value={llm.baseUrl}
            onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">مدل</label>
          <input
            className="input"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">API Token</label>
          <input
            className="input"
            type="password"
            value={llm.apiToken}
            onChange={(e) => setLlm({ ...llm, apiToken: e.target.value })}
            placeholder={llm.hasToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'sk-...'}
            dir="ltr"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={llm.usePlatformFallback}
            onChange={(e) => setLlm({ ...llm, usePlatformFallback: e.target.checked })}
          />
          در صورت نبود توکن شخصی، از کلید پلتفرم استفاده شود
        </label>
        <button className="btn-primary w-fit">ذخیره LLM</button>
      </form>
    </div>
  );
}
