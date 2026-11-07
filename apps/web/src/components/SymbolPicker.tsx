'use client';

import { useEffect, useRef, useState } from 'react';
import { api, formatNum } from '@/lib/api';

export type PickedSymbol = { symbol: string; nameFa: string; price: number | null };

type Quote = {
  symbol: string;
  nameFa: string;
  last: { lastPrice?: number | null; closePrice?: number | null } | null;
};

/** جست‌وجوی نماد از دیتابیس بازار تهران؛ با تایپ، چند نماد نزدیک پیشنهاد می‌شود. */
export function SymbolPicker({
  value,
  assetType,
  onChange,
  disabled,
}: {
  value: string;
  assetType: string;
  onChange: (picked: PickedSymbol) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  const [results, setResults] = useState<Quote[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => setText(value), [value]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 1) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q, assetType, take: '8', page: '1' });
        const data = await api<{ items: Quote[] }>(`/market/quotes?${params}`);
        if (mine === seq.current) setResults(data.items ?? []);
      } catch {
        if (mine === seq.current) setResults([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text, assetType, open]);

  function pick(quote: Quote) {
    const price = quote.last?.lastPrice ?? quote.last?.closePrice ?? null;
    onChange({ symbol: quote.symbol, nameFa: quote.nameFa, price: price && price > 0 ? price : null });
    setText(quote.symbol);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className="input"
        value={text}
        disabled={disabled}
        placeholder="مثلاً فولاد"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onChange({ symbol: e.target.value, nameFa: '', price: null });
        }}
      />
      {open && text.trim() && (results.length > 0 || loading) && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-navy-900/10 bg-white py-1 text-sm shadow-soft">
          {loading && !results.length && <li className="px-3 py-2 text-navy-800/50">در حال جست‌وجو…</li>}
          {results.map((quote) => {
            const price = quote.last?.lastPrice ?? quote.last?.closePrice ?? null;
            return (
              <li key={quote.symbol}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right hover:bg-navy-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(quote)}
                >
                  <span>
                    <span className="font-semibold">{quote.symbol}</span>
                    <span className="mr-2 text-navy-800/55">{quote.nameFa}</span>
                  </span>
                  {price != null && price > 0 && (
                    <span className="shrink-0 text-xs text-navy-800/50">{formatNum(price)} ریال</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
