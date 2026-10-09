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
      <div>
        <h1 className="text-3xl font-bold">سوابق هوش مصنوعی</h1>
        <p className="mt-2 text-navy-800/70">
          پرامپت کامل، جواب مدل، توکن و هزینهٔ هر فراخوانی موفق. چت کاربران، اخبار و تحلیل صندوق‌ها هم اینجاست.
        </p>
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

      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="card space-y-3">
            <button type="button" className="w-full text-start" onClick={() => openItem(item.id)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-bold">{item.sectionFa}</div>
                  <div className="mt-1 text-sm text-navy-800/70">{item.userLabel}</div>
                  {item.email && (
                    <div className="text-xs text-navy-800/45" dir="ltr">
                      {item.email}
                    </div>
                  )}
                </div>
                <div className="text-sm text-navy-800/70">{formatShamsiDateTime(item.createdAt)}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>{formatNum(item.totalTokens)} توکن</span>
                <span>{formatRial(item.costRial)}</span>
                {item.model && (
                  <span dir="ltr" className="text-navy-800/55">
                    {item.model}
                  </span>
                )}
                {item.estimated && <span className="text-navy-800/45">برآورد توکن</span>}
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-navy-800/80">
                {item.promptPreview || 'برای دیدن پرامپت و جواب کامل باز کنید.'}
              </p>
            </button>

            {openId === item.id && (
              <div className="space-y-3 border-t border-navy-900/10 pt-3">
                {detailError && <p className="text-sm text-red-700">{detailError}</p>}
                {!detail && !detailError && <p className="text-sm text-navy-800/60">در حال خواندن متن کامل...</p>}
                {detail && detail.id === item.id && (
                  <>
                    <p className="text-xs text-navy-800/50">
                      ورودی {formatNum(detail.promptTokens)} · خروجی {formatNum(detail.completionTokens)} ·{' '}
                      {formatNum(detail.promptChars)} نویسه پرامپت · {formatNum(detail.responseChars)} نویسه جواب
                    </p>
                    <TextBlock title="فرستاده‌شده به مدل" text={detail.prompt} />
                    <TextBlock title="جواب مدل" text={detail.response} />
                  </>
                )}
              </div>
            )}
          </article>
        ))}

        {!loading && items.length === 0 && (
          <p className="text-sm text-navy-800/60">سابقه‌ای برای این فیلتر نیست. رکوردها از استقرار این نسخه به بعد پر می‌شوند.</p>
        )}

        {nextCursor && (
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => void load(nextCursor)}>
            سابقه‌های قدیمی‌تر
          </button>
        )}
      </div>
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
