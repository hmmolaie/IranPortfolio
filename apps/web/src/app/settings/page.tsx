'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

type ProviderId = 'openrouter' | 'openai' | 'custom';

const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string; hint: string }
> = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free, google/gemma-3-27b-it:free',
    hint: 'کلید sk-or-v1-... از openrouter.ai — مدل‌های رایگان ممکن است ۴۲۹ بدهند.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'کلید sk-... از platform.openai.com',
  },
  custom: {
    label: 'سفارشی (سازگار با OpenAI)',
    baseUrl: '',
    model: '',
    hint: 'هر endpoint سازگار با /chat/completions (مثلاً DeepSeek، Groq، Azure).',
  },
};

function detectProvider(baseUrl: string): ProviderId {
  if (baseUrl.includes('openrouter.ai')) return 'openrouter';
  if (baseUrl.includes('api.openai.com')) return 'openai';
  return 'custom';
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState({ name: '', riskTolerance: 5, horizonMonths: 12, notes: '' });
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const [llm, setLlm] = useState({
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
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
        setProvider(detectProvider(s.baseUrl));
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

  function applyProvider(next: ProviderId) {
    setProvider(next);
    const p = PROVIDERS[next];
    setLlm((prev) => ({
      ...prev,
      baseUrl: p.baseUrl || prev.baseUrl,
      model: p.model || prev.model,
    }));
  }

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
        <p className="rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-800/80">
          اشتراک Cursor API عمومی برای اپلیکیشن‌های بیرونی ندارد؛ فقط داخل IDE کار می‌کند. برای سبدیار از
          OpenRouter، OpenAI یا هر سرویس سازگار با OpenAI استفاده کنید.
        </p>

        <div>
          <label className="label">ارائه‌دهنده</label>
          <select
            className="input"
            value={provider}
            onChange={(e) => applyProvider(e.target.value as ProviderId)}
          >
            {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-navy-800/55">{PROVIDERS[provider].hint}</p>
        </div>

        <div>
          <label className="label">Base URL</label>
          <input
            className="input"
            value={llm.baseUrl}
            onChange={(e) => {
              const baseUrl = e.target.value;
              setLlm({ ...llm, baseUrl });
              setProvider(detectProvider(baseUrl));
            }}
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">مدل (چندتایی با ویرگول = جایگزین خودکار)</label>
          <input
            className="input"
            value={llm.model}
            onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            dir="ltr"
            placeholder="model-a:free, model-b:free"
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
