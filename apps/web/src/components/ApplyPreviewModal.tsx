'use client';

import { useEffect, useState } from 'react';
import { api, formatNum, formatRial } from '@/lib/api';

export type PreviewSuggestion = {
  titleFa: string;
  action?: string;
  symbol?: string;
  assetType?: string;
  quantity?: number;
  amountRial?: number;
  weightPct?: number;
};

type Holding = { symbol: string; assetType: string; quantity: number; amountRial: number; marketValueRial?: number | null; lastPrice?: number | null };

type FeeRates = {
  stockBuyPct: number;
  stockSellPct: number;
  physicalUsdBuyPct: number;
  physicalUsdSellPct: number;
  physicalGoldBuyPct: number;
  physicalGoldSellPct: number;
};

const ACTION_FA: Record<string, string> = {
  ADD: 'خرید جدید',
  INCREASE: 'افزایش',
  DECREASE: 'کاهش',
  REMOVE: 'فروش کامل',
  SET: 'تنظیم به مقدار',
};

function feePct(rates: FeeRates | null, assetType: string | undefined, sell: boolean) {
  if (!rates) return 0;
  if (assetType === 'CASH' || assetType === 'DEPOSIT') return 0;
  if (assetType === 'PHYSICAL_USD') return sell ? rates.physicalUsdSellPct : rates.physicalUsdBuyPct;
  if (assetType === 'PHYSICAL_GOLD') return sell ? rates.physicalGoldSellPct : rates.physicalGoldBuyPct;
  return sell ? rates.stockSellPct : rates.stockBuyPct;
}

/**
 * پیش‌نمایش «بازچینش بر اساس پیشنهادها»: هر اقدام با مبلغ تقریبی و کارمزد برآوردی پیش از نوشتن در سبد.
 * مبلغ دقیق را سرور با قیمت روز حساب می‌کند؛ این جدول برآورد است.
 */
export function ApplyPreviewModal({
  suggestions,
  holdings,
  capitalRial,
  busy,
  onCancel,
  onConfirm,
}: {
  suggestions: PreviewSuggestion[];
  holdings: Holding[];
  capitalRial: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [rates, setRates] = useState<FeeRates | null>(null);

  useEffect(() => {
    api<FeeRates>('/portfolios/trade-fees/rates')
      .then(setRates)
      .catch(() => setRates(null));
  }, []);

  const rows = suggestions.map((s) => {
    const held = holdings.find((h) => h.symbol === s.symbol);
    const heldValue = held ? held.marketValueRial ?? held.amountRial : 0;
    const sell = s.action === 'DECREASE' || s.action === 'REMOVE';
    let amount: number | null = null;
    if (s.action === 'REMOVE') amount = heldValue || null;
    else if (s.amountRial != null && s.amountRial > 0) amount = s.amountRial;
    else if (s.quantity != null && s.quantity > 0 && held?.lastPrice) amount = s.quantity * held.lastPrice;
    else if (s.weightPct != null && s.weightPct > 0) amount = (s.weightPct / 100) * capitalRial;
    if (s.action === 'SET' && amount != null) amount = Math.abs(amount - heldValue);
    const setSell = s.action === 'SET' && amount != null && s.amountRial != null && s.amountRial < heldValue;
    const fee = amount != null ? (amount * feePct(rates, s.assetType ?? held?.assetType, sell || setSell)) / 100 : null;
    return { s, amount, fee, sell: sell || setSell };
  });
  const buyTotal = rows.filter((r) => !r.sell).reduce((t, r) => t + (r.amount ?? 0), 0);
  const sellTotal = rows.filter((r) => r.sell).reduce((t, r) => t + (r.amount ?? 0), 0);
  const feeTotal = rows.reduce((t, r) => t + (r.fee ?? 0), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-preview-title"
    >
      <div className="card max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto shadow-soft">
        <h2 id="apply-preview-title" className="text-lg font-semibold text-navy-900">
          پیش‌نمایش تغییرات سبد
        </h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-navy-800/55">
                <th className="px-2 py-2 text-start font-medium">اقدام</th>
                <th className="px-2 py-2 text-start font-medium">نماد</th>
                <th className="px-2 py-2 text-start font-medium">مقدار</th>
                <th className="px-2 py-2 text-start font-medium">مبلغ تقریبی</th>
                <th className="px-2 py-2 text-start font-medium">کارمزد برآوردی</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ s, amount, fee, sell }, i) => (
                <tr key={i} className="border-t border-navy-900/5" title={s.titleFa}>
                  <td className={`px-2 py-2 ${sell ? 'text-red-700' : 'text-emerald-700'}`}>
                    {ACTION_FA[s.action ?? ''] ?? s.action}
                  </td>
                  <td className="px-2 py-2 font-medium">{s.symbol}</td>
                  <td className="px-2 py-2">
                    {s.quantity != null && s.quantity > 0
                      ? `${formatNum(s.quantity)} واحد`
                      : s.weightPct != null && s.weightPct > 0
                        ? `${formatNum(s.weightPct)}٪ سرمایه`
                        : s.action === 'REMOVE'
                          ? 'همهٔ موجودی'
                          : '—'}
                  </td>
                  <td className="px-2 py-2">{amount != null ? formatRial(Math.round(amount)) : '—'}</td>
                  <td className="px-2 py-2">{fee != null ? formatRial(Math.round(fee)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 rounded-lg bg-navy-50/70 px-3 py-2 text-sm sm:grid-cols-3">
          <div>جمع خرید: {formatRial(Math.round(buyTotal))}</div>
          <div>جمع فروش: {formatRial(Math.round(sellTotal))}</div>
          <div>کارمزد کل: {formatRial(Math.round(feeTotal))}</div>
        </div>
        <p className="text-xs leading-6 text-navy-800/60">
          مبلغ‌ها برآورد با آخرین قیمت است؛ مقدار دقیق هنگام نوشتن در سبد با قیمت روز حساب می‌شود. این تغییر فقط در
          سبدیار ثبت می‌شود و معامله‌ای در کارگزاری انجام نمی‌دهد.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? '...' : 'تأیید و اعمال در سبد'}
          </button>
        </div>
      </div>
    </div>
  );
}
