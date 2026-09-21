'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, formatRial } from '@/lib/api';
import { formatShamsiDate } from '@/lib/shamsi-date';
import { useToast } from '@/components/Toast';

type WalletTxKind = 'GATEWAY' | 'ADMIN' | 'TELEGRAM' | 'SUGGEST' | 'REBALANCE' | 'REFUND';

type WalletSummary = {
  enabled: boolean;
  balanceRial: number;
  costs: {
    telegramDailyRial: number;
    suggestRial: number;
    rebalanceRial: number;
  };
  gatewayReady: boolean;
  transactions: Array<{
    id: string;
    amountRial: number;
    kind: WalletTxKind;
    balanceAfterRial: number;
    note: string | null;
    createdAt: string;
  }>;
};

type AdminSettings = {
  enabled: boolean;
  sandbox: boolean;
  hasMerchant: boolean;
  telegramDailyRial: number;
  suggestRial: number;
  rebalanceRial: number;
  callbackUrl: string | null;
};

type WalletUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'ADMIN' | 'USER';
  walletBalanceRial: number;
};

const KIND_FA: Record<WalletTxKind, string> = {
  GATEWAY: 'شارژ از درگاه',
  ADMIN: 'شارژ دستی مدیر',
  TELEGRAM: 'پیام روزانه تلگرام',
  SUGGEST: 'پیشنهاد سبد با هوش مصنوعی',
  REBALANCE: 'بازچینش سبد',
  REFUND: 'برگشت وجه',
};

function digitsOnly(raw: string) {
  return raw.replace(/[^\d]/g, '');
}

export function WalletPanel() {
  const toast = useToast();
  const [data, setData] = useState<WalletSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setData(await api<WalletSummary>('/wallet'));
  }

  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, []);

  async function onCharge(e: FormEvent) {
    e.preventDefault();
    const amountRial = Number(digitsOnly(amount));
    if (!Number.isInteger(amountRial) || amountRial < 10_000) {
      toast.error('حداقل مبلغ شارژ ۱۰٬۰۰۰ ریال است.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ url: string }>('/wallet/charge', {
        method: 'POST',
        body: JSON.stringify({ amountRial }),
      });
      window.location.assign(res.url);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">موجودی کیف پول</h2>
        <p className="text-3xl font-semibold">{data ? formatRial(data.balanceRial) : '...'}</p>
        {data && !data.enabled && (
          <p className="text-sm leading-7 text-navy-800/75">
            کسر از کیف پول توسط مدیر خاموش است و استفاده از قابلیت‌ها رایگان است.
          </p>
        )}
        {data?.enabled && (
          <ul className="space-y-1 text-sm leading-7 text-navy-800/80">
            <li>پیام روزانه تلگرام: {formatRial(data.costs.telegramDailyRial)}</li>
            <li>پیشنهاد سبد با هوش مصنوعی: {formatRial(data.costs.suggestRial)}</li>
            <li>بازچینش سبد: {formatRial(data.costs.rebalanceRial)}</li>
          </ul>
        )}
      </section>

      <form onSubmit={onCharge} className="card max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">شارژ ریالی</h2>
        <p className="text-sm leading-7 text-navy-800/75">
          مبلغ به ریال است. پس از تأیید به درگاه زرین‌پال می‌روید و بعد از پرداخت به همین صفحه برمی‌گردید.
        </p>
        <div>
          <label className="label">مبلغ شارژ (ریال)</label>
          <input
            className="input max-w-xs"
            dir="ltr"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(digitsOnly(e.target.value))}
            placeholder="100000"
          />
        </div>
        <button type="submit" className="btn-primary w-fit" disabled={busy || data?.gatewayReady === false}>
          {busy ? 'در حال اتصال به درگاه...' : 'پرداخت با زرین‌پال'}
        </button>
        {data && !data.gatewayReady && (
          <p className="text-sm text-red-700">درگاه پرداخت هنوز آماده نیست. با مدیر سایت تماس بگیرید.</p>
        )}
      </form>

      <section className="card max-w-2xl space-y-3">
        <h2 className="text-lg font-semibold">گردش حساب</h2>
        {!data?.transactions.length && <p className="text-sm text-navy-800/70">هنوز تراکنشی ثبت نشده است.</p>}
        {!!data?.transactions.length && (
          <ul className="divide-y divide-navy-900/10 text-sm">
            {data.transactions.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div>{KIND_FA[row.kind]}</div>
                  <div className="text-navy-800/55">{formatShamsiDate(row.createdAt, 'long')}</div>
                </div>
                <div className="text-end">
                  <div dir="ltr">{formatRial(row.amountRial)}</div>
                  <div className="text-navy-800/55">مانده {formatRial(row.balanceAfterRial)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function WalletAdminPanel() {
  const toast = useToast();
  const [form, setForm] = useState<AdminSettings & { merchantId: string } | null>(null);
  const [users, setUsers] = useState<WalletUser[]>([]);
  const [userId, setUserId] = useState('');
  const [credit, setCredit] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<AdminSettings>('/wallet/admin/settings'), api<WalletUser[]>('/wallet/admin/users')])
      .then(([settings, list]) => {
        setForm({ ...settings, merchantId: '' });
        setUsers(list);
        setUserId(list[0]?.id ?? '');
      })
      .catch((e) => toast.error((e as Error).message));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      const saved = await api<AdminSettings>('/wallet/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: form.enabled,
          sandbox: form.sandbox,
          merchantId: form.merchantId.trim() || undefined,
          telegramDailyRial: form.telegramDailyRial,
          suggestRial: form.suggestRial,
          rebalanceRial: form.rebalanceRial,
        }),
      });
      setForm({ ...saved, merchantId: '' });
      toast.success('تنظیمات کیف پول ذخیره شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function creditUser(e: FormEvent) {
    e.preventDefault();
    const amountRial = Number(digitsOnly(credit));
    if (!userId || !Number.isInteger(amountRial) || amountRial < 1) {
      toast.error('کاربر و مبلغ شارژ را مشخص کنید.');
      return;
    }
    setBusy(true);
    try {
      await api('/wallet/admin/credit', {
        method: 'POST',
        body: JSON.stringify({ userId, amountRial, note: note.trim() || undefined }),
      });
      const list = await api<WalletUser[]>('/wallet/admin/users');
      setUsers(list);
      setCredit('');
      setNote('');
      toast.success('کیف پول کاربر شارژ شد.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!form) return <p className="text-sm text-navy-800/70">در حال خواندن تنظیمات...</p>;

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">کسر از کیف پول</h2>
        <p className="text-sm leading-7 text-navy-800/75">
          اگر این گزینه خاموش باشد، پیام روزانه تلگرام، پیشنهاد سبد و بازچینش رایگان است. مبلغ‌ها به ریال هستند و صفر یعنی همان قابلیت رایگان می‌ماند.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          کسر از کیف پول فعال باشد
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.sandbox}
            onChange={(e) => setForm({ ...form, sandbox: e.target.checked })}
          />
          درگاه آزمایشی زرین‌پال
        </label>
        <div>
          <label className="label">توکن پذیرنده زرین‌پال</label>
          <input
            className="input"
            dir="ltr"
            type="password"
            autoComplete="off"
            value={form.merchantId}
            placeholder={form.hasMerchant ? 'ذخیره شده؛ برای تعویض مقدار جدید بنویسید' : ''}
            onChange={(e) => setForm({ ...form, merchantId: e.target.value.trim() })}
          />
        </div>
        <div>
          <label className="label">هزینه پیام روزانه تلگرام</label>
          <input
            className="input max-w-xs"
            dir="ltr"
            inputMode="numeric"
            value={String(form.telegramDailyRial)}
            onChange={(e) => setForm({ ...form, telegramDailyRial: Number(digitsOnly(e.target.value) || '0') })}
          />
        </div>
        <div>
          <label className="label">هزینه پیشنهاد سبد با هوش مصنوعی</label>
          <input
            className="input max-w-xs"
            dir="ltr"
            inputMode="numeric"
            value={String(form.suggestRial)}
            onChange={(e) => setForm({ ...form, suggestRial: Number(digitsOnly(e.target.value) || '0') })}
          />
          <p className="mt-1 text-xs text-navy-800/55">ساخت سبد جدید و دکمه آنالیز سبد جاری</p>
        </div>
        <div>
          <label className="label">هزینه بازچینش سبد</label>
          <input
            className="input max-w-xs"
            dir="ltr"
            inputMode="numeric"
            value={String(form.rebalanceRial)}
            onChange={(e) => setForm({ ...form, rebalanceRial: Number(digitsOnly(e.target.value) || '0') })}
          />
        </div>
        {form.callbackUrl ? (
          <p className="text-sm leading-7 text-navy-800/70">
            بازگشت از درگاه:
            <span className="mt-1 block" dir="ltr">
              {form.callbackUrl}
            </span>
          </p>
        ) : (
          <p className="text-sm text-red-700">نشانی عمومی سایت در env تنظیم نشده و بازگشت از درگاه ممکن نیست.</p>
        )}
        <button type="submit" className="btn-primary w-fit" disabled={busy}>
          {busy ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
        </button>
      </form>

      <form onSubmit={creditUser} className="card max-w-2xl space-y-4">
        <h2 className="text-lg font-semibold">شارژ دستی</h2>
        <div>
          <label className="label">کاربر</label>
          <select className="input" dir="ltr" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          {users.find((u) => u.id === userId) && (
            <p className="mt-1 text-sm text-navy-800/70">
              موجودی فعلی {formatRial(users.find((u) => u.id === userId)!.walletBalanceRial)}
            </p>
          )}
        </div>
        <div>
          <label className="label">مبلغ (ریال)</label>
          <input
            className="input max-w-xs"
            dir="ltr"
            inputMode="numeric"
            value={credit}
            onChange={(e) => setCredit(digitsOnly(e.target.value))}
          />
        </div>
        <div>
          <label className="label">یادداشت (اختیاری)</label>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary w-fit" disabled={busy || !users.length}>
          شارژ کیف پول
        </button>
      </form>
    </div>
  );
}
