'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

type ProviderId = 'openrouter' | 'openai' | 'custom';

type FundDefinition = {
  id: string;
  nameFa: string;
  symbolCode?: string | null;
  description?: string | null;
};

type LlmPrompt = {
  purpose: string;
  labelFa: string;
  descriptionFa: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  isCustom: boolean;
};

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
  const [profile, setProfile] = useState({
    name: '',
    riskTolerance: 5,
    horizonMonths: 12,
    notes: '',
    investmentPreferencesFa: '',
    constraintsFa: '',
  });
  const [provider, setProvider] = useState<ProviderId>('openrouter');
  const [llm, setLlm] = useState({
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    apiToken: '',
    usePlatformFallback: true,
    hasToken: false,
  });
  const [fundDefs, setFundDefs] = useState<FundDefinition[]>([]);
  const [newFund, setNewFund] = useState({ nameFa: '', symbolCode: '', description: '' });
  const [prompts, setPrompts] = useState<LlmPrompt[]>([]);
  const [openPrompt, setOpenPrompt] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState('');
  const [msg, setMsg] = useState('');

  async function loadPrompts() {
    const list = await api<LlmPrompt[]>('/llm/prompts');
    setPrompts(list);
  }

  async function loadFundDefs() {
    const defs = await api<FundDefinition[]>('/funds/definitions');
    setFundDefs(defs);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<{
      name?: string;
      profile?: {
        riskTolerance: number;
        horizonMonths: number;
        notes?: string | null;
        investmentPreferencesFa?: string | null;
        constraintsFa?: string | null;
      };
    }>('/users/me').then((u) => {
      setProfile({
        name: u.name ?? '',
        riskTolerance: u.profile?.riskTolerance ?? 5,
        horizonMonths: u.profile?.horizonMonths ?? 12,
        notes: u.profile?.notes ?? '',
        investmentPreferencesFa: u.profile?.investmentPreferencesFa ?? '',
        constraintsFa: u.profile?.constraintsFa ?? '',
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
    loadFundDefs().catch(() => undefined);
    loadPrompts().catch(() => undefined);
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
        investmentPreferencesFa: profile.investmentPreferencesFa,
        constraintsFa: profile.constraintsFa,
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

  async function addFund(e: FormEvent) {
    e.preventDefault();
    if (!newFund.nameFa.trim()) return;
    await api('/funds/definitions', {
      method: 'POST',
      body: JSON.stringify({
        nameFa: newFund.nameFa.trim(),
        symbolCode: newFund.symbolCode.trim() || undefined,
        description: newFund.description.trim() || undefined,
      }),
    });
    setNewFund({ nameFa: '', symbolCode: '', description: '' });
    await loadFundDefs();
    setMsg('صندوق اضافه شد.');
  }

  async function removeFund(id: string, name: string) {
    if (!confirm(`صندوق «${name}» غیرفعال شود؟`)) return;
    await api(`/funds/definitions/${id}`, { method: 'DELETE' });
    await loadFundDefs();
    setMsg('صندوق حذف شد.');
  }

  function updatePromptText(purpose: string, systemPrompt: string) {
    setPrompts((prev) => prev.map((p) => (p.purpose === purpose ? { ...p, systemPrompt } : p)));
  }

  async function savePrompt(purpose: string) {
    const p = prompts.find((x) => x.purpose === purpose);
    if (!p) return;
    setPromptBusy(purpose);
    try {
      await api(`/llm/prompts/${purpose}`, {
        method: 'PUT',
        body: JSON.stringify({ systemPrompt: p.systemPrompt }),
      });
      await loadPrompts();
      setMsg(`پرامپت «${p.labelFa}» ذخیره شد.`);
    } finally {
      setPromptBusy('');
    }
  }

  async function resetPrompt(purpose: string) {
    const p = prompts.find((x) => x.purpose === purpose);
    if (!p || !confirm(`پرامپت «${p.labelFa}» به پیش‌فرض برگردد؟`)) return;
    setPromptBusy(purpose);
    try {
      await api(`/llm/prompts/${purpose}`, { method: 'DELETE' });
      await loadPrompts();
      setMsg(`پرامپت «${p.labelFa}» بازنشانی شد.`);
    } finally {
      setPromptBusy('');
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">تنظیمات</h1>
        <p className="mt-2 text-navy-800/70">پروفایل، پرامپت‌ها، صندوق‌ها و اتصال به مدل زبانی</p>
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
        <div>
          <label className="label">علاقه‌مندی‌های سرمایه‌گذاری</label>
          <textarea
            className="input min-h-[5rem]"
            value={profile.investmentPreferencesFa}
            onChange={(e) => setProfile({ ...profile, investmentPreferencesFa: e.target.value })}
            placeholder="مثلاً تمایل به سهام صنعتی، اجتناب از نمادهای پرنوسان..."
          />
        </div>
        <div>
          <label className="label">محدودیت‌ها</label>
          <textarea
            className="input min-h-[5rem]"
            value={profile.constraintsFa}
            onChange={(e) => setProfile({ ...profile, constraintsFa: e.target.value })}
            placeholder="مثلاً بدون اهرم، حداکثر ۲۰٪ طلا، عدم سرمایه‌گذاری در بانک‌ها..."
          />
        </div>
        <button className="btn-primary w-fit">ذخیره پروفایل</button>
      </form>

      <section className="card max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">صندوق‌های سرمایه‌گذاری</h2>
        <p className="text-sm text-navy-800/70">
          یک‌بار نام صندوق‌ها را اینجا تعریف کنید؛ در صفحه صندوق‌ها از لیست انتخاب می‌شوند.
        </p>
        <ul className="space-y-2">
          {fundDefs.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-navy-900/10 px-3 py-2"
            >
              <div>
                <span className="font-medium">{f.nameFa}</span>
                {f.symbolCode && (
                  <span className="ms-2 text-xs text-navy-800/50">{f.symbolCode}</span>
                )}
              </div>
              <button
                type="button"
                className="text-xs text-red-700 hover:underline"
                onClick={() => removeFund(f.id, f.nameFa)}
              >
                حذف
              </button>
            </li>
          ))}
          {fundDefs.length === 0 && (
            <li className="text-sm text-navy-800/50">هنوز صندوقی تعریف نشده.</li>
          )}
        </ul>
        <form onSubmit={addFund} className="grid gap-3 border-t border-navy-900/10 pt-4">
          <div>
            <label className="label">نام صندوق</label>
            <input
              className="input"
              value={newFund.nameFa}
              onChange={(e) => setNewFund({ ...newFund, nameFa: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">کد / نماد (اختیاری)</label>
            <input
              className="input"
              value={newFund.symbolCode}
              onChange={(e) => setNewFund({ ...newFund, symbolCode: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-secondary w-fit">
            افزودن صندوق
          </button>
        </form>
      </section>

      <section className="card max-w-3xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">پرامپت‌های LLM</h2>
          <p className="mt-1 text-sm text-navy-800/70">
            متن system هر بخش نرم‌افزار را ویرایش کنید. پس از ذخیره، همان پرامپت به مدل ارسال می‌شود.
          </p>
        </div>
        <div className="space-y-3">
          {prompts.map((p) => {
            const isOpen = openPrompt === p.purpose;
            return (
              <div key={p.purpose} className="rounded-lg border border-navy-900/10">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
                  onClick={() => setOpenPrompt(isOpen ? null : p.purpose)}
                >
                  <div>
                    <div className="font-medium">{p.labelFa}</div>
                    <div className="text-xs text-navy-800/55">{p.descriptionFa}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {p.isCustom && (
                      <span className="rounded bg-gold-400/20 px-2 py-0.5 text-gold-600">سفارشی</span>
                    )}
                    <span className="text-navy-800/40">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="space-y-3 border-t border-navy-900/10 px-4 py-3">
                    <div>
                      <label className="label">شناسه</label>
                      <input className="input font-mono text-xs" value={p.purpose} readOnly dir="ltr" />
                    </div>
                    <div>
                      <label className="label">پرامپت system</label>
                      <textarea
                        className="input min-h-[12rem] font-mono text-xs leading-6"
                        value={p.systemPrompt}
                        onChange={(e) => updatePromptText(p.purpose, e.target.value)}
                        dir="auto"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={promptBusy === p.purpose}
                        onClick={() => savePrompt(p.purpose)}
                      >
                        {promptBusy === p.purpose ? '...' : 'ذخیره پرامپت'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={promptBusy === p.purpose}
                        onClick={() => resetPrompt(p.purpose)}
                      >
                        بازگشت به پیش‌فرض
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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
