'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { adminApiErrorText, api, getToken, getUserRole } from '@/lib/api';
import { TELEGRAM_BOT_USERNAME } from '@/lib/telegram';
import { TelegramBotLink } from '@/components/TelegramBotLink';
import { useToast } from '@/components/Toast';
import { formatShamsiDate } from '@/lib/shamsi-date';

type TelegramLink = {
  userId: string;
  name?: string | null;
  email: string;
  isActive: boolean;
  mobilePhone?: string | null;
  telegramUsername?: string | null;
  telegramLinkedAt?: string | null;
  telegramPortfolioEnabled: boolean;
  telegramNewsEnabled: boolean;
};

const SEND_WEEKDAYS = [
  { id: 6, label: 'شنبه' },
  { id: 0, label: 'یکشنبه' },
  { id: 1, label: 'دوشنبه' },
  { id: 2, label: 'سه‌شنبه' },
  { id: 3, label: 'چهارشنبه' },
  { id: 4, label: 'پنجشنبه' },
  { id: 5, label: 'جمعه' },
];

function clockValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export default function TelegramNotifyPage() {
  const router = useRouter();
  const toast = useToast();
  const [tgForm, setTgForm] = useState({
    botNameFa: 'سبدیار',
    botUsername: TELEGRAM_BOT_USERNAME,
    botToken: '',
    ttsBaseUrl: '',
    ttsApiToken: '',
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: 'alloy',
    sendHour: 8,
    sendMinute: 30,
    sendWeekdays: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
  });
  const [tgMeta, setTgMeta] = useState({
    hasToken: false,
    hasTtsToken: false,
    linkedCount: 0,
    lastDigest: null as {
      dateKey: string;
      sentCount: number;
      failedCount: number;
      skippedReasonFa?: string | null;
    } | null,
  });
  const [links, setLinks] = useState<TelegramLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadConfig() {
    const c = await api<{
      botNameFa?: string;
      botUsername?: string;
      enabled?: boolean;
      ttsBaseUrl?: string;
      hasTtsToken?: boolean;
      ttsModel?: string;
      ttsVoice?: string;
      sendHour?: number;
      sendMinute?: number;
      sendWeekdays?: number[];
      hasToken?: boolean;
      linkedCount?: number;
      lastDigest?: {
        dateKey: string;
        sentCount: number;
        failedCount: number;
        skippedReasonFa?: string | null;
      } | null;
    }>('/telegram/config');
    setTgForm({
      botNameFa: c.botNameFa?.trim() || 'سبدیار',
      botUsername: c.botUsername?.trim() || TELEGRAM_BOT_USERNAME,
      botToken: '',
      ttsBaseUrl: c.ttsBaseUrl?.trim() || '',
      ttsApiToken: '',
      ttsModel: c.ttsModel?.trim() || 'gpt-4o-mini-tts',
      ttsVoice: c.ttsVoice?.trim() || 'alloy',
      sendHour: c.sendHour ?? 8,
      sendMinute: c.sendMinute ?? 30,
      sendWeekdays: c.sendWeekdays?.length ? c.sendWeekdays : [0, 1, 2, 3, 4, 5, 6],
      enabled: c.enabled ?? true,
    });
    setTgMeta({
      hasToken: Boolean(c.hasToken),
      hasTtsToken: Boolean(c.hasTtsToken),
      linkedCount: c.linkedCount ?? 0,
      lastDigest: c.lastDigest ?? null,
    });
  }

  async function loadLinks() {
    setLinks(await api<TelegramLink[]>('/telegram/links'));
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
    loadConfig().catch((err) => toast.error((err as Error).message));
    loadLinks().catch((err) => toast.error((err as Error).message));
  }, [router]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!tgForm.sendWeekdays.length) {
      const text = 'حداقل یک روز هفته را برای ارسال انتخاب کنید.';
      setFeedback({ ok: false, text });
      toast.error(text);
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await api('/telegram/config', {
        method: 'PUT',
        body: JSON.stringify({
          botNameFa: tgForm.botNameFa.trim(),
          botUsername: tgForm.botUsername.trim().replace(/^@/, ''),
          ttsBaseUrl: tgForm.ttsBaseUrl.trim(),
          ttsModel: tgForm.ttsModel.trim(),
          ttsVoice: tgForm.ttsVoice.trim(),
          ...(tgForm.ttsApiToken.trim() ? { ttsApiToken: tgForm.ttsApiToken.trim() } : {}),
          sendHour: tgForm.sendHour,
          sendMinute: tgForm.sendMinute,
          sendWeekdays: tgForm.sendWeekdays,
          enabled: tgForm.enabled,
          ...(tgForm.botToken.trim() ? { botToken: tgForm.botToken.trim() } : {}),
        }),
      });
      setTgForm((p) => ({ ...p, botToken: '', ttsApiToken: '' }));
      await loadConfig();
      const text = 'تنظیمات اطلاع‌رسانی تلگرام ذخیره شد.';
      setFeedback({ ok: true, text });
      toast.success(text);
    } catch (err) {
      const text = (err as Error).message || 'ذخیره ربات ناموفق بود.';
      setFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function run(path: string, fallback: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string }>(path, { method: 'POST' });
      const text = res.messageFa ?? fallback;
      setFeedback({ ok: res.ok !== false, text });
      if (res.ok === false) toast.error(text);
      else toast.success(text);
      return res;
    } catch (err) {
      const text = adminApiErrorText(err) || fallback;
      setFeedback({ ok: false, text });
      toast.error(text);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendToday() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api<{ ok: boolean; messageFa?: string }>('/telegram/send-today', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      const text = res.messageFa ?? 'ارسال انجام شد.';
      setFeedback({ ok: Boolean(res.ok), text });
      if (res.ok) toast.success(text);
      else toast.error(text);
      await loadConfig();
      if (res.ok) {
        for (const delay of [20_000, 60_000, 150_000]) {
          setTimeout(() => {
            void loadConfig().catch(() => undefined);
          }, delay);
        }
      }
    } catch (err) {
      const text = adminApiErrorText(err) || 'ارسال ناموفق بود.';
      setFeedback({ ok: false, text });
      toast.error(text);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(link: TelegramLink, field: 'portfolio' | 'news') {
    const portfolio = field === 'portfolio' ? !link.telegramPortfolioEnabled : undefined;
    const news = field === 'news' ? !link.telegramNewsEnabled : undefined;
    setBusy(true);
    try {
      await api(`/telegram/links/${link.userId}/notify`, {
        method: 'PUT',
        body: JSON.stringify({
          ...(portfolio != null ? { portfolio } : {}),
          ...(news != null ? { news } : {}),
        }),
      });
      await loadLinks();
      toast.success(field === 'portfolio' ? 'وضعیت به‌روزرسانی سبد ذخیره شد.' : 'وضعیت اخبار و فرصت‌ها ذخیره شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(link: TelegramLink) {
    const label = link.name || link.email;
    if (!confirm(`اتصال «${label}» به ربات قطع شود؟ پیام روزانه دیگر برای این نفر نمی‌رود.`)) return;
    setBusy(true);
    try {
      await api(`/telegram/links/${link.userId}/unlink`, { method: 'POST' });
      toast.success('اتصال این کاربر به ربات قطع شد.');
      await Promise.all([loadConfig(), loadLinks()]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">اطلاع‌رسانی تلگرام</h1>
        <p className="mt-2 text-navy-800/70">
          ارسال پیام روزانه، به‌روزرسانی سبد، و اخبار و فرصت‌های سرمایه‌گذاری از همین صفحه تنظیم می‌شود.
        </p>
      </div>

      <form onSubmit={save} className="card grid max-w-2xl gap-4">
        <p className="text-sm leading-7 text-navy-800/75">
          ربات عمومی سبدیار همین است:
          <br />
          <TelegramBotLink />
          <br />
          نام کاربری پیش‌فرض را عوض نکنید مگر ربات دیگری می‌سازید. توکن را از BotFather بگیرید و ذخیره کنید. سرویس API باید روشن بماند تا در روز و ساعت انتخاب‌شده پیام برود. اخبار و فرصت‌ها هم به‌صورت فایل صوتی فارسی با صدای زن (حداکثر حدود دو دقیقه) فرستاده می‌شود. کاربر باید موبایل را در پروفایل ثبت کند و ربات را استارت کند؛ تلگرام با شماره به‌تنهایی پیام نمی‌فرستد.
        </p>
        <div>
          <label className="label">نام ربات (برای متن پیام)</label>
          <input
            className="input"
            value={tgForm.botNameFa}
            onChange={(e) => setTgForm({ ...tgForm, botNameFa: e.target.value })}
            placeholder="سبدیار"
          />
        </div>
        <div>
          <label className="label">نام کاربری ربات (بدون @)</label>
          <input
            className="input"
            value={tgForm.botUsername}
            onChange={(e) => setTgForm({ ...tgForm, botUsername: e.target.value })}
            placeholder={TELEGRAM_BOT_USERNAME}
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">توکن ربات</label>
          <input
            className="input"
            type="password"
            value={tgForm.botToken}
            onChange={(e) => setTgForm({ ...tgForm, botToken: e.target.value })}
            placeholder={tgMeta.hasToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'از BotFather'}
            dir="ltr"
          />
        </div>
        <div>
          <label className="label">نشانی پایه گفتار</label>
          <input
            className="input"
            value={tgForm.ttsBaseUrl}
            onChange={(e) => setTgForm({ ...tgForm, ttsBaseUrl: e.target.value })}
            placeholder="https://api.gapgpt.app/v1"
            dir="ltr"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label">توکن گفتار</label>
          <input
            className="input"
            type="password"
            value={tgForm.ttsApiToken}
            onChange={(e) => setTgForm({ ...tgForm, ttsApiToken: e.target.value })}
            placeholder={tgMeta.hasTtsToken ? 'برای جایگزینی توکن جدید وارد کنید' : 'کلید سرویس گفتار'}
            dir="ltr"
            spellCheck={false}
          />
          <p className="mt-1 text-xs leading-6 text-navy-800/55">
            اگر نشانی یا توکن خالی باشد، اتصال مدل زبانی همین مدیر استفاده می‌شود. این توکن، توکن ربات تلگرام نیست.
          </p>
        </div>
        <div>
          <label className="label">مدل متن به صدا</label>
          <input
            className="input"
            value={tgForm.ttsModel}
            onChange={(e) => setTgForm({ ...tgForm, ttsModel: e.target.value })}
            placeholder="gpt-4o-mini-tts"
            dir="ltr"
            spellCheck={false}
          />
          <p className="mt-1 text-xs leading-6 text-navy-800/55">
            مدل و صدا از همین‌جا خوانده می‌شوند. اگر نام مدل روی سرویس سازگار با OpenAI شناخته نشود، به gpt-4o-mini-tts عوض می‌شود.
          </p>
        </div>
        <div>
          <label className="label">صدای گفتار</label>
          <input
            className="input"
            value={tgForm.ttsVoice}
            onChange={(e) => setTgForm({ ...tgForm, ttsVoice: e.target.value })}
            placeholder="alloy"
            dir="ltr"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label">ساعت ارسال (تهران)</label>
          <input
            className="input max-w-[10rem]"
            type="time"
            value={clockValue(tgForm.sendHour, tgForm.sendMinute)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (!Number.isInteger(h) || !Number.isInteger(m)) return;
              setTgForm({ ...tgForm, sendHour: h, sendMinute: m });
            }}
            dir="ltr"
          />
        </div>
        <fieldset>
          <legend className="label">روزهای ارسال</legend>
          <div className="flex flex-wrap gap-2">
            {SEND_WEEKDAYS.map((day) => {
              const on = tgForm.sendWeekdays.includes(day.id);
              return (
                <label
                  key={day.id}
                  className={clsx(
                    'cursor-pointer rounded-full border px-3 py-1.5 text-sm',
                    on ? 'border-navy-900 bg-navy-900 text-white' : 'border-navy-900/15 bg-white text-navy-800',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => {
                      const sendWeekdays = on
                        ? tgForm.sendWeekdays.filter((id) => id !== day.id)
                        : [...tgForm.sendWeekdays, day.id];
                      setTgForm({ ...tgForm, sendWeekdays });
                    }}
                  />
                  {day.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tgForm.enabled}
            onChange={(e) => setTgForm({ ...tgForm, enabled: e.target.checked })}
          />
          ارسال خودکار در روزها و ساعت انتخاب‌شده فعال باشد
        </label>
        <div className="rounded-lg border border-navy-100 bg-white px-3 py-3 text-sm text-navy-800/80">
          <div>توکن ربات ذخیره شده: {tgMeta.hasToken ? 'بله' : 'خیر'}</div>
          <div className="mt-1">توکن گفتار ذخیره شده: {tgMeta.hasTtsToken ? 'بله' : 'خیر'}</div>
          <div className="mt-1">کاربران وصل‌شده: {tgMeta.linkedCount.toLocaleString('fa-IR')}</div>
          {tgMeta.lastDigest && (
            <div className="mt-1">
              آخرین ارسال: {formatShamsiDate(tgMeta.lastDigest.dateKey)} — موفق{' '}
              {tgMeta.lastDigest.sentCount.toLocaleString('fa-IR')}
              {tgMeta.lastDigest.skippedReasonFa ? ` — ${tgMeta.lastDigest.skippedReasonFa}` : ''}
            </div>
          )}
        </div>
        <p className="text-xs leading-6 text-navy-800/60">
          «تست پیام به موبایل من» فقط به تلگرام وصل‌شده با شماره موبایل همین حساب مدیر می‌رود. کاربران دیگر این پیام را نمی‌گیرند و ارسال روزانهٔ همه عوض نمی‌شود.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary w-fit" disabled={busy}>
            {busy ? 'در حال ذخیره...' : 'ذخیره'}
          </button>
          <button type="button" className="btn-secondary w-fit" disabled={busy || !tgMeta.hasToken} onClick={() => void run('/telegram/test', 'تست ربات ناموفق بود.')}>
            تست اتصال
          </button>
          <button type="button" className="btn-secondary w-fit" disabled={busy || !tgMeta.hasToken} onClick={() => void run('/telegram/test-message', 'ارسال پیام آزمایشی ناموفق بود.')}>
            تست پیام به موبایل من
          </button>
          <button type="button" className="btn-secondary w-fit" disabled={busy || !tgMeta.hasToken} onClick={() => void run('/telegram/test-voice', 'ساخت فایل صوتی ناموفق بود.')}>
            تست فایل صوتی به موبایل من
          </button>
          <button type="button" className="btn-secondary w-fit" disabled={busy || !tgMeta.hasToken} onClick={() => void sendToday()}>
            ارسال خلاصهٔ امروز
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
            {feedback.ok ? '✓ ' : '! '}
            {feedback.text}
          </div>
        )}
      </form>

      <section className="card overflow-x-auto p-0">
        <div className="px-4 py-4">
          <h2 className="text-lg font-semibold">کاربران وصل‌شده</h2>
          <p className="mt-1 text-sm leading-7 text-navy-800/70">
            به‌روزرسانی سبد شامل نمودار و پیشنهاد بهبود است. اخبار و فرصت‌ها شامل متن و فایل صوتی همان بخش است. هر دو برای کاربر وصل‌شده روشن‌اند تا اینجا خاموش شوند.
          </p>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-navy-900 text-white">
            <tr>
              <th className="px-4 py-3 text-start font-medium">نام</th>
              <th className="px-4 py-3 text-start font-medium">نام کاربری</th>
              <th className="px-4 py-3 text-start font-medium">موبایل</th>
              <th className="px-4 py-3 text-start font-medium">تلگرام</th>
              <th className="px-4 py-3 text-start font-medium">به‌روزرسانی سبد</th>
              <th className="px-4 py-3 text-start font-medium">اخبار و فرصت‌ها</th>
              <th className="px-4 py-3 text-start font-medium">اتصال</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.userId} className="border-b border-navy-900/5 odd:bg-white even:bg-navy-50/40">
                <td className="px-4 py-3 font-medium">{link.name || '—'}</td>
                <td className="px-4 py-3">{link.email}</td>
                <td className="px-4 py-3" dir="ltr">{link.mobilePhone || '—'}</td>
                <td className="px-4 py-3" dir="ltr">{link.telegramUsername ? `@${link.telegramUsername}` : '—'}</td>
                <td className="px-4 py-3">
                  <button type="button" className="text-xs text-navy-800 underline" disabled={busy} onClick={() => void toggle(link, 'portfolio')}>
                    {link.telegramPortfolioEnabled ? 'فعال' : 'خاموش'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button type="button" className="text-xs text-navy-800 underline" disabled={busy} onClick={() => void toggle(link, 'news')}>
                    {link.telegramNewsEnabled ? 'فعال' : 'خاموش'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button type="button" className="text-xs text-red-700 hover:underline" disabled={busy} onClick={() => void unlink(link)}>
                    قطع اتصال
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {links.length === 0 && <p className="p-6 text-sm text-navy-800/60">کسی به ربات وصل نیست.</p>}
      </section>
    </div>
  );
}
