'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, formatRial } from '@/lib/api';
import { SymbolPicker } from '@/components/SymbolPicker';

type Kind = 'STOCK' | 'FUND' | 'GOLD_ETF' | 'OPTION' | 'PHYSICAL_GOLD' | 'PHYSICAL_USD' | 'DEPOSIT';

const KINDS: Array<{ value: Kind; label: string; unit: string }> = [
  { value: 'STOCK', label: 'سهام', unit: 'سهم' },
  { value: 'FUND', label: 'صندوق سرمایه‌گذاری', unit: 'واحد' },
  { value: 'GOLD_ETF', label: 'صندوق طلا', unit: 'واحد' },
  { value: 'OPTION', label: 'اختیار معامله', unit: 'قرارداد' },
  { value: 'PHYSICAL_GOLD', label: 'طلای فیزیکی', unit: 'گرم' },
  { value: 'PHYSICAL_USD', label: 'دلار فیزیکی', unit: 'دلار' },
  { value: 'DEPOSIT', label: 'سپرده بانکی', unit: 'ریال' },
];

/** نوع‌هایی که نماد بورسی ندارند و نمادشان ثابت است */
const FIXED_SYMBOL: Partial<Record<Kind, string>> = {
  PHYSICAL_GOLD: 'PHYSICAL_GOLD',
  PHYSICAL_USD: 'PHYSICAL_USD',
};

type Row = {
  key: number;
  kind: Kind;
  symbol: string;
  nameFa: string;
  price: number | null;
  by: 'qty' | 'amount';
  qty: string;
  amount: string;
  avgBuy: string;
};

let nextKey = 1;

function blankRow(kind: Kind = 'STOCK'): Row {
  return {
    key: nextKey++,
    kind,
    symbol: FIXED_SYMBOL[kind] ?? (kind === 'DEPOSIT' ? 'سپرده' : ''),
    nameFa: '',
    price: kind === 'DEPOSIT' ? 1 : null,
    by: kind === 'DEPOSIT' ? 'amount' : 'qty',
    qty: '',
    amount: '',
    avgBuy: '',
  };
}

/** ارقام فارسی و جداکننده‌ها به عدد */
function toNumber(raw: string): number | null {
  const text = raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[,،\s]/g, '');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rowValue(row: Row): number | null {
  if (row.by === 'amount') return toNumber(row.amount);
  const qty = toNumber(row.qty);
  return qty != null && row.price != null ? qty * row.price : null;
}

export function ImportPortfolioForm({
  strategies,
  onCreated,
}: {
  strategies: Array<{ value: string; label: string }>;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('سبد فعلی من');
  const [strategy, setStrategy] = useState('GROWTH');
  const [rows, setRows] = useState<Row[]>(() => [blankRow()]);
  const [cash, setCash] = useState('');
  const [spot, setSpot] = useState<{ usdIrr: number | null; goldGramRial: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ usdIrr: number | null; goldGramRial: number | null } | null>('/prices/latest')
      .then(setSpot)
      .catch(() => undefined);
  }, []);

  function update(key: number, patch: Partial<Row>) {
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function changeKind(key: number, kind: Kind) {
    const fresh = blankRow(kind);
    const price =
      kind === 'PHYSICAL_GOLD' ? spot?.goldGramRial ?? null : kind === 'PHYSICAL_USD' ? spot?.usdIrr ?? null : fresh.price;
    update(key, { ...fresh, key, price });
  }

  const holdingsTotal = rows.reduce((sum, row) => sum + (rowValue(row) ?? 0), 0);
  const cashRial = toNumber(cash) ?? 0;
  const total = holdingsTotal + cashRial;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const filled = rows.filter((row) => row.symbol.trim() && (toNumber(row.qty) || toNumber(row.amount)));
    if (!filled.length && cashRial <= 0) {
      setError('دست‌کم یک دارایی با تعداد یا مبلغ، یا مبلغ نقد وارد کنید.');
      return;
    }
    setSaving(true);
    try {
      const created = await api<{ id: string }>('/portfolios', {
        method: 'POST',
        body: JSON.stringify({
          name,
          strategy,
          cashRial,
          holdings: filled.map((row) => ({
            symbol: row.symbol.trim(),
            assetType: row.kind,
            ...(row.by === 'qty' ? { quantity: toNumber(row.qty) } : { amountRial: toNumber(row.amount) }),
            ...(toNumber(row.avgBuy) ? { avgBuyPrice: toNumber(row.avgBuy) } : {}),
          })),
        }),
      });
      onCreated(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">نام سبد</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required disabled={saving} />
        </div>
        <div>
          <label className="label">هدف شما برای بازچینش</label>
          <select className="input" value={strategy} onChange={(e) => setStrategy(e.target.value)} disabled={saving}>
            {strategies.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">دارایی‌های فعلی</h3>
          <span className="text-xs text-navy-800/55">یکی از تعداد یا مبلغ کافی است؛ میانگین خرید اختیاری است</span>
        </div>
        {rows.map((row, index) => {
          const unit = KINDS.find((k) => k.value === row.kind)?.unit ?? '';
          const value = rowValue(row);
          const fixed = Boolean(FIXED_SYMBOL[row.kind]) || row.kind === 'DEPOSIT';
          return (
            <div
              key={row.key}
              className="grid gap-3 rounded-xl border border-navy-900/10 bg-cream/40 p-3 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_9rem_1fr_1fr_auto]"
            >
              <div>
                <label className="label text-xs">نوع</label>
                <select
                  className="input"
                  value={row.kind}
                  disabled={saving}
                  onChange={(e) => changeKind(row.key, e.target.value as Kind)}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label text-xs">{row.kind === 'DEPOSIT' ? 'نام سپرده' : 'نماد'}</label>
                {fixed && row.kind !== 'DEPOSIT' ? (
                  <input className="input bg-navy-50" value={KINDS.find((k) => k.value === row.kind)?.label ?? ''} disabled />
                ) : row.kind === 'DEPOSIT' ? (
                  <input
                    className="input"
                    value={row.symbol}
                    disabled={saving}
                    onChange={(e) => update(row.key, { symbol: e.target.value })}
                  />
                ) : (
                  <SymbolPicker
                    value={row.symbol}
                    assetType={row.kind}
                    disabled={saving}
                    onChange={(picked) => update(row.key, picked)}
                  />
                )}
                {row.nameFa && <p className="mt-1 truncate text-xs text-navy-800/55">{row.nameFa}</p>}
              </div>
              <div>
                <label className="label text-xs">ورود با</label>
                <select
                  className="input"
                  value={row.by}
                  disabled={saving || row.kind === 'DEPOSIT'}
                  onChange={(e) => update(row.key, { by: e.target.value as 'qty' | 'amount' })}
                >
                  <option value="qty">تعداد ({unit})</option>
                  <option value="amount">مبلغ (ریال)</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">{row.by === 'qty' ? `تعداد (${unit})` : 'مبلغ (ریال)'}</label>
                <input
                  className="input"
                  inputMode="decimal"
                  dir="ltr"
                  disabled={saving}
                  value={row.by === 'qty' ? row.qty : row.amount}
                  onChange={(e) =>
                    update(row.key, row.by === 'qty' ? { qty: e.target.value } : { amount: e.target.value })
                  }
                />
                <p className="mt-1 text-xs text-navy-800/55">
                  {value != null ? `ارزش روز حدود ${formatRial(value)}` : row.price == null && row.by === 'qty' ? 'قیمت روز بعد از ثبت حساب می‌شود' : ''}
                </p>
              </div>
              <div>
                <label className="label text-xs">میانگین قیمت خرید (اختیاری)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  dir="ltr"
                  disabled={saving || row.kind === 'DEPOSIT'}
                  value={row.avgBuy}
                  placeholder={row.kind === 'DEPOSIT' ? '—' : 'ریال'}
                  onChange={(e) => update(row.key, { avgBuy: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40"
                  disabled={saving || rows.length === 1}
                  onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  aria-label={`حذف ردیف ${index + 1}`}
                >
                  حذف
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={() => setRows((list) => [...list, blankRow()])}
        >
          + افزودن دارایی
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">پول نقد (ریال)</label>
          <input
            className="input"
            inputMode="numeric"
            dir="ltr"
            value={cash}
            disabled={saving}
            onChange={(e) => setCash(e.target.value)}
            placeholder="۰"
          />
        </div>
        <div className="flex flex-col justify-end rounded-xl bg-navy-900 px-4 py-3 text-white">
          <span className="text-xs text-white/60">ارزش تقریبی کل سبد (سرمایه)</span>
          <span className="text-xl font-bold">{formatRial(total)}</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={saving}>
          {saving ? 'در حال ثبت سبد...' : 'ثبت سبد و ادامه'}
        </button>
        <span className="text-xs text-navy-800/55">
          ثبت سبد رایگان است و هوش مصنوعی را صدا نمی‌زند. در صفحهٔ بعد می‌توانید آنالیز و بازچینش بگیرید.
        </span>
      </div>
    </form>
  );
}
