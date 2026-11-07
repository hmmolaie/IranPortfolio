'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { adminApiErrorText, api, getToken, getUserRole } from '@/lib/api';
import { useToast } from '@/components/Toast';

type DigestRun = {
  slotKey: string;
  manual: boolean;
  status: string;
  itemCount: number;
  errorFa?: string | null;
  createdAt: string;
};

type DigestTopic = { titleFa: string; focusFa: string; itemsCount: number };

type DigestConfig = {
  botUsername: string;
  hasToken: boolean;
  chatId: string;
  intervalHours: number;
  startHour: number;
  sendMinute: number;
  topics: DigestTopic[];
  enabled: boolean;
  running: boolean;
  runs: DigestRun[];
};

const MAX_TOPICS = 8;
const MAX_ITEMS = 10;

const STATUS_FA: Record<string, string> = {
  running: 'در حال ساخت',
  sent: 'فرستاده شد',
  error: 'خطا',
  cancelled: 'لغو (خاموش بود)',
};

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? Math.round(v) : lo));
}

function faDigits(s: string) {
  return s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function clockLabel(h: number, m: number) {
  return faDigits(`${String(h === 0 ? 24 : h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
}

/** ساعت‌هایی که با این دوره و ساعت شروع، خبرنامه فرستاده می‌شود؛ شمارش هر روز از ساعت شروع تازه می‌شود */
function slotHours(intervalHours: number, startHour: number): number[] {
  const step = clamp(intervalHours, 1, 24);
  const hours: number[] = [];
  for (let d = 0; d < 24; d += step) hours.push((startHour + d) % 24);
  return hours.sort((a, b) => a - b);
}

export default function PersonalDigestPage() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    botUsername: 'dailynewshamidbot',
    botToken: '',
    chatId: '',
    intervalHours: 6,
    startHour: 0,
    sendMinute: 0,
    topics: [] as DigestTopic[],
    enabled: true,
  });
  const [hasToken, setHasToken] = useState(false);
  const [runs, setRuns] = useState<DigestRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const c = await api<DigestConfig>('/personal-digest/config');
    setForm({
      botUsername: c.botUsername || 'dailynewshamidbot',
      botToken: '',
      chatId: c.chatId,
      intervalHours: c.intervalHours,
      startHour: c.startHour,
      sendMinute: c.sendMinute,
      topics: c.topics,
      enabled: c.enabled,
    });
    setHasToken(c.hasToken);
    setRuns(c.runs);
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    if (getUserRole() !== 'ADMIN') {
      router.replace('/dashboard');
      return;
    }
    load().catch((err) => toast.error((err as Error).message));
  }, [router]);

  function show(ok: boolean, text: string) {
    setFeedback({ ok, text });
    if (ok) toast.success(text);
    else toast.error(text);
  }

  function setTopic(index: number, patch: Partial<DigestTopic>) {
    setForm((p) => ({ ...p, topics: p.topics.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));
  }

  function addTopic() {
    setForm((p) =>
      p.topics.length >= MAX_TOPICS ? p : { ...p, topics: [...p.topics, { titleFa: '', focusFa: '', itemsCount: 5 }] },
    );
  }

  function removeTopic(index: number) {
    setForm((p) => ({ ...p, topics: p.topics.filter((_, i) => i !== index) }));
  }

  function moveTopic(index: number, dir: -1 | 1) {
    setForm((p) => {
      const j = index + dir;
      if (j < 0 || j >= p.topics.length) return p;
      const topics = [...p.topics];
      [topics[index], topics[j]] = [topics[j], topics[index]];
      return { ...p, topics };
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const topics = form.topics
      .map((t) => ({ titleFa: t.titleFa.trim(), focusFa: t.focusFa.trim(), itemsCount: clamp(t.itemsCount, 1, MAX_ITEMS) }))
      .filter((t) => t.titleFa);
    if (!topics.length) {
      show(false, 'حداقل یک سرفصل با عنوان لازم است.');
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api('/personal-digest/config', {
        method: 'PUT',
        body: JSON.stringify({
          botUsername: form.botUsername.trim().replace(/^@/, ''),
          chatId: form.chatId.trim(),
          intervalHours: clamp(form.intervalHours, 1, 24),
          startHour: clamp(form.startHour, 0, 23),
          sendMinute: clamp(form.sendMinute, 0, 59),
          topics,
          ...(form.botToken.trim() ? { botToken: form.botToken.trim() } : {}),
        }),
      });
      await load();
      show(true, 'تنظیمات خبرنامه ذخیره شد.');
    } catch (err) {
      show(false, adminApiErrorText(err) || 'ذخیره ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }

  /** کلید اصلی؛ بلافاصله ذخیره می‌شود و بقیهٔ فرم دست نمی‌خورد */
  async function toggleEnabled() {
    const enabled = !form.enabled;
    setBusy(true);
    setFeedback(null);
    try {
      await api('/personal-digest/config', { method: 'PUT', body: JSON.stringify({ enabled }) });
      setForm((p) => ({ ...p, enabled }));
      show(true, enabled ? 'خبرنامه روشن شد.' : 'خبرنامه خاموش شد؛ دیگر هیچ خبری فرستاده نمی‌شود.');
    } catch (err) {
      show(false, adminApiErrorText(err) || 'تغییر وضعیت ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }

  async function run(path: string, fallback: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string }>(path, { method: 'POST' });
      show(res.ok !== false, res.messageFa ?? fallback);
      await load();
    } catch (err) {
      show(false, adminApiErrorText(err) || fallback);
    } finally {
      setBusy(false);
    }
  }

  const totalItems = form.topics.reduce((sum, t) => sum + (t.titleFa.trim() ? clamp(t.itemsCount, 1, MAX_ITEMS) : 0), 0);
  const schedule = slotHours(form.intervalHours, form.startHour)
    .map((h) => clockLabel(h, clamp(form.sendMinute, 0, 59)))
    .join('، ');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">خبرنامهٔ شخصی تلگرام</h1>
        <p className="mt-2 text-navy-800/70">
          فنی‌ترین پست‌های X در سرفصل‌های دلخواه شما، با خلاصهٔ فارسی، فقط برای تلگرام خود مدیر. به کاربران سبدیار ربطی ندارد.
        </p>
      </div>

      <section
        className={clsx(
          'card flex max-w-3xl flex-wrap items-center justify-between gap-4 border-2',
          form.enabled ? 'border-emerald-500/40' : 'border-red-500/30',
        )}
      >
        <div>
          <h2 className="text-lg font-semibold">
            وضعیت خبرنامه:{' '}
            <span className={form.enabled ? 'text-emerald-700' : 'text-red-700'}>{form.enabled ? 'روشن' : 'خاموش'}</span>
          </h2>
          <p className="mt-1 text-sm leading-7 text-navy-800/70">
            {form.enabled
              ? 'در ساعت‌های دورهٔ تناوب، خبرها و مقاله‌ها ساخته و به تلگرام شما فرستاده می‌شوند.'
              : 'هیچ خبر یا مقاله‌ای ساخته یا فرستاده نمی‌شود؛ نه زمان‌بندی‌شده، نه «همین حالا بفرست». تنظیمات سر جایش می‌ماند.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          aria-label="روشن یا خاموش کردن خبرنامه"
          disabled={busy}
          onClick={() => void toggleEnabled()}
          className={clsx(
            'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50',
            form.enabled ? 'bg-emerald-600' : 'bg-navy-900/25',
          )}
        >
          <span
            className={clsx(
              'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all',
              form.enabled ? 'start-7' : 'start-1',
            )}
          />
        </button>
      </section>

      <form onSubmit={save} className="grid max-w-3xl gap-6">
        <section className="card grid gap-4">
          <h2 className="text-lg font-semibold">ربات و چت</h2>
          <ol className="list-decimal space-y-1 ps-5 text-sm leading-7 text-navy-800/75">
            <li>توکن ربات را از BotFather کپی کنید و در خانهٔ «توکن ربات» بگذارید، بعد «ذخیره».</li>
            <li>در تلگرام ربات خودتان را باز کنید و Start بزنید یا یک پیام بفرستید.</li>
            <li>دکمهٔ «پیدا کردن شناسهٔ چت من» را بزنید.</li>
            <li>«پیام آزمایشی» و بعد «همین حالا بفرست» را امتحان کنید.</li>
          </ol>
          <div>
            <label className="label">نام کاربری ربات (بدون @)</label>
            <input
              className="input"
              value={form.botUsername}
              onChange={(e) => setForm({ ...form, botUsername: e.target.value })}
              dir="ltr"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="label">توکن ربات</label>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={form.botToken}
              onChange={(e) => setForm({ ...form, botToken: e.target.value })}
              placeholder={hasToken ? 'ذخیره شده؛ فقط برای عوض کردن پر کنید' : 'از BotFather'}
              dir="ltr"
              spellCheck={false}
            />
            <p className="mt-1 text-xs leading-6 text-navy-800/55">توکن رمزنگاری‌شده در پایگاه داده می‌ماند و دوباره نمایش داده نمی‌شود.</p>
          </div>
          <div>
            <label className="label">شناسهٔ چت تلگرام شما</label>
            <div className="flex flex-wrap gap-2">
              <input
                className="input max-w-[16rem]"
                value={form.chatId}
                onChange={(e) => setForm({ ...form, chatId: e.target.value })}
                placeholder="خودکار پیدا می‌شود"
                dir="ltr"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn-secondary w-fit"
                disabled={busy || !hasToken}
                onClick={() => void run('/personal-digest/detect-chat', 'پیدا کردن شناسهٔ چت ناموفق بود.')}
              >
                پیدا کردن شناسهٔ چت من
              </button>
            </div>
          </div>
        </section>

        <section className="card grid gap-4">
          <h2 className="text-lg font-semibold">دورهٔ تناوب</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">هر چند ساعت یک‌بار</label>
              <input
                className="input"
                type="number"
                min={1}
                max={24}
                value={form.intervalHours}
                onChange={(e) => setForm({ ...form, intervalHours: clamp(Number(e.target.value), 1, 24) })}
                dir="ltr"
              />
            </div>
            <div>
              <label className="label">ساعت شروع (تهران، ۰ تا ۲۳)</label>
              <input
                className="input"
                type="number"
                min={0}
                max={23}
                value={form.startHour}
                onChange={(e) => setForm({ ...form, startHour: clamp(Number(e.target.value), 0, 23) })}
                dir="ltr"
              />
            </div>
            <div>
              <label className="label">دقیقه</label>
              <input
                className="input"
                type="number"
                min={0}
                max={59}
                value={form.sendMinute}
                onChange={(e) => setForm({ ...form, sendMinute: clamp(Number(e.target.value), 0, 59) })}
                dir="ltr"
              />
            </div>
          </div>
          <p className="rounded-lg bg-navy-50/60 px-3 py-2 text-sm leading-7 text-navy-800/80">
            ساعت‌های ارسال در هر روز: {schedule}
          </p>
        </section>

        <section className="card grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">سرفصل‌ها و تعداد پست در هر نوبت</h2>
            <span className="text-sm text-navy-800/60">جمع هر نوبت: {totalItems.toLocaleString('fa-IR')} پست</span>
          </div>
          {form.topics.map((topic, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-navy-900/10 bg-white p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <div>
                  <label className="label">عنوان سرفصل</label>
                  <input
                    className="input"
                    value={topic.titleFa}
                    maxLength={80}
                    onChange={(e) => setTopic(i, { titleFa: e.target.value })}
                    placeholder="مثلاً 🛡 امنیت سایبری"
                  />
                </div>
                <div>
                  <label className="label">تعداد پست</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={MAX_ITEMS}
                    value={topic.itemsCount}
                    onChange={(e) => setTopic(i, { itemsCount: clamp(Number(e.target.value), 1, MAX_ITEMS) })}
                    dir="ltr"
                  />
                </div>
              </div>
              <div>
                <label className="label">دنبال چه بگردد؟ (اختیاری)</label>
                <textarea
                  className="input min-h-[4.5rem]"
                  value={topic.focusFa}
                  maxLength={600}
                  onChange={(e) => setTopic(i, { focusFa: e.target.value })}
                  placeholder="زیرموضوع‌ها، کلیدواژه‌ها یا حساب‌های مهم"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary w-fit" disabled={i === 0} onClick={() => moveTopic(i, -1)}>
                  بالاتر
                </button>
                <button
                  type="button"
                  className="btn-secondary w-fit"
                  disabled={i === form.topics.length - 1}
                  onClick={() => moveTopic(i, 1)}
                >
                  پایین‌تر
                </button>
                <button
                  type="button"
                  className="text-sm text-red-700 hover:underline disabled:opacity-40"
                  disabled={form.topics.length <= 1}
                  onClick={() => removeTopic(i)}
                >
                  حذف سرفصل
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary w-fit"
            disabled={form.topics.length >= MAX_TOPICS}
            onClick={addTopic}
          >
            افزودن سرفصل
          </button>
          <p className="text-xs leading-6 text-navy-800/60">
            حداکثر {MAX_TOPICS.toLocaleString('fa-IR')} سرفصل و {MAX_ITEMS.toLocaleString('fa-IR')} پست برای هر سرفصل. جستجو و خلاصه با همان اتصال Grok مدیر انجام می‌شود و هزینه‌اش در «هزینه هوش مصنوعی» با بخش «خبرنامهٔ شخصی تلگرام» می‌آید.
          </p>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary w-fit" disabled={busy}>
            {busy ? 'لطفاً صبر کنید...' : 'ذخیره'}
          </button>
          <button
            type="button"
            className="btn-secondary w-fit"
            disabled={busy || !hasToken || !form.chatId}
            onClick={() => void run('/personal-digest/test-message', 'ارسال پیام آزمایشی ناموفق بود.')}
          >
            پیام آزمایشی
          </button>
          <button
            type="button"
            className="btn-secondary w-fit"
            disabled={busy || !hasToken || !form.chatId || !form.enabled}
            title={form.enabled ? undefined : 'خبرنامه خاموش است'}
            onClick={() => void run('/personal-digest/send-now', 'ارسال خبرنامه ناموفق بود.')}
          >
            همین حالا بفرست
          </button>
        </div>
        {feedback && (
          <div
            className={clsx(
              'whitespace-pre-wrap break-words rounded-lg px-3 py-3 text-sm leading-7',
              feedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
            )}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.text}
          </div>
        )}
      </form>

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 py-4">
          <h2 className="text-lg font-semibold">نوبت‌های اخیر</h2>
          <button type="button" className="btn-secondary w-fit" disabled={busy} onClick={() => void load()}>
            تازه کردن
          </button>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">زمان</th>
              <th className="px-4 py-3 text-start font-medium">نوع</th>
              <th className="px-4 py-3 text-start font-medium">وضعیت</th>
              <th className="px-4 py-3 text-start font-medium">تعداد</th>
              <th className="px-4 py-3 text-start font-medium">خطا</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.slotKey} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                <td className="px-4 py-3">{new Date(r.createdAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</td>
                <td className="px-4 py-3">{r.manual ? 'دستی' : 'زمان‌بندی‌شده'}</td>
                <td className={clsx('px-4 py-3', r.status === 'error' && 'text-red-700')}>{STATUS_FA[r.status] ?? r.status}</td>
                <td className="px-4 py-3">{r.itemCount.toLocaleString('fa-IR')}</td>
                <td className="max-w-md break-words px-4 py-3 text-xs text-red-700">{r.errorFa ?? ''}</td>
              </tr>
            ))}
            {!runs.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-navy-800/60">
                  هنوز نوبتی اجرا نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
