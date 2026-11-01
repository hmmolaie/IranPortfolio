'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatNum, formatRial, getToken, getUserRole } from '@/lib/api';
import { formatShamsiDateTime } from '@/lib/shamsi-date';

type HistoryUser = {
  id: string;
  email: string;
  name: string | null;
};

type HistorySection = {
  section: string;
  labelFa: string;
};

type HistoryItem = {
  id: string;
  userLabel: string;
  email: string | null;
  sectionFa: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costRial: number;
  estimated: boolean;
  ok: boolean;
  createdAt: string;
  promptPreview: string;
  responsePreview: string;
  promptChars: number;
  responseChars: number;
};

type HistoryPage = {
  users: HistoryUser[];
  sections: HistorySection[];
  items: HistoryItem[];
  nextCursor: string | null;
};

type HistoryDetail = HistoryItem & {
  prompt: string;
  response: string;
};

export default function AiHistoryPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [section, setSection] = useState('');
  const [users, setUsers] = useState<HistoryUser[]>([]);
  const [sections, setSections] = useState<HistorySection[]>([]);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (userId) params.set('userId', userId);
      if (section) params.set('section', section);
      if (cursor) params.set('cursor', cursor);
      const query = params.toString();
      setLoading(true);
      return api<HistoryPage>(`/ai-usage/history${query ? `?${query}` : ''}`)
        .then((data) => {
          setUsers(data.users);
          setSections(data.sections);
          setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
          setNextCursor(data.nextCursor);
          setError('');
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => setLoading(false));
    },
    [section, userId],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'ADMIN') {
      router.replace('/dashboard');
      return;
    }
    setOpenId(null);
    setDetail(null);
    void load();
  }, [load, router]);

  async function clearHistory() {
    if (!confirm('همهٔ سوابق هوش مصنوعی حذف شوند؟ توکن و هزینهٔ همین فراخوانی‌ها هم از گزارش هزینه پاک می‌شود.')) return;
    setClearing(true);
    setError('');
    try {
      await api('/ai-usage/history', { method: 'DELETE' });
      setItems([]);
      setNextCursor(null);
      setOpenId(null);
      setDetail(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  function openItem(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    setDetailError('');
    api<HistoryDetail>(`/ai-usage/history/${id}`)
      .then(setDetail)
      .catch((e) => setDetailError((e as Error).message));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">سوابق هوش مصنوعی</h1>
          <p className="mt-2 text-navy-800/70">
            زمان، بخش، کاربر، مدل، توکن و نتیجهٔ هر فراخوانی. با کلیک روی ردیف، متن ورودی و خروجی باز می‌شود. اخبار و آنالیز خودکار با نام سیستم ثبت می‌شوند.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={clearing || (items.length === 0 && !userId && !section)}
          onClick={() => void clearHistory()}
        >
          {clearing ? 'در حال حذف...' : 'حذف سوابق'}
        </button>
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">کاربر</span>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">همه</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name?.trim() || user.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">بخش</span>
          <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">همه</option>
            {sections.map((item) => (
              <option key={item.section} value={item.section}>
                {item.labelFa}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-3 py-3 text-start font-medium">زمان</th>
              <th className="px-3 py-3 text-start font-medium">بخش</th>
              <th className="px-3 py-3 text-start font-medium">کاربر</th>
              <th className="px-3 py-3 text-start font-medium">مدل</th>
              <th className="px-3 py-3 text-start font-medium">توکن ورودی</th>
              <th className="px-3 py-3 text-start font-medium">توکن خروجی</th>
              <th className="px-3 py-3 text-start font-medium">هزینه</th>
              <th className="px-3 py-3 text-start font-medium">نتیجه</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const selected = openId === item.id;
              return (
                <tr
                  key={item.id}
                  className={`cursor-pointer border-b border-navy-900/5 ${
                    selected ? 'bg-gold-400/30' : 'odd:bg-white even:bg-navy-50/40'
                  }`}
                  onClick={() => openItem(item.id)}
                >
                  <td className="whitespace-nowrap px-3 py-3">{formatShamsiDateTime(item.createdAt)}</td>
                  <td className="px-3 py-3 font-medium">{item.sectionFa}</td>
                  <td className="px-3 py-3">{item.userLabel}</td>
                  <td className="px-3 py-3" dir="ltr">
                    {item.model || '—'}
                  </td>
                  <td className="px-3 py-3">{formatNum(item.promptTokens)}</td>
                  <td className="px-3 py-3">{formatNum(item.completionTokens)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{formatRial(item.costRial)}</td>
                  <td className={`px-3 py-3 font-medium ${item.ok ? 'text-emerald-800' : 'text-red-700'}`}>
                    {item.ok ? 'موفق' : 'خطا'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && items.length === 0 && (
          <p className="px-4 py-4 text-sm text-navy-800/60">سابقه‌ای برای این فیلتر نیست.</p>
        )}
      </section>

      {openId && (
        <div className="card space-y-3">
          {detailError && <p className="text-sm text-red-700">{detailError}</p>}
          {!detail && !detailError && <p className="text-sm text-navy-800/60">در حال خواندن متن کامل...</p>}
          {detail && detail.id === openId && (
            <>
              <p className="text-xs text-navy-800/50">
                {detail.sectionFa}
                {' · '}
                {detail.userLabel}
                {' · '}
                ورودی {formatNum(detail.promptTokens)} · خروجی {formatNum(detail.completionTokens)}
                {detail.estimated ? ' · برآورد توکن' : ''}
              </p>
              {detail.model && (
                <p className="text-xs text-navy-800/50" dir="ltr">
                  {detail.model}
                </p>
              )}
              <TextBlock title="فرستاده‌شده به مدل" text={detail.prompt} />
              <TextBlock title={detail.ok ? 'جواب مدل' : 'متن خطا'} text={detail.response} />
            </>
          )}
        </div>
      )}

      {nextCursor && (
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => void load(nextCursor)}>
          سابقه‌های قدیمی‌تر
        </button>
      )}
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-bold">{title}</h3>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-navy-900/5 p-3 text-xs leading-6" dir="auto">
        {text.trim() || 'متنی ذخیره نشده است.'}
      </pre>
    </div>
  );
}
