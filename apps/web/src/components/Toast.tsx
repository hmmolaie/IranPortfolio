'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import clsx from 'clsx';

type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  push: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const text = message.trim();
    if (!text) return;
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-4), { id, message: text, tone }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto toast-enter max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg ring-1 backdrop-blur-sm',
              t.tone === 'success' && 'bg-emerald-700/95 text-white ring-emerald-900/20',
              t.tone === 'error' && 'bg-red-700/95 text-white ring-red-900/20',
              t.tone === 'info' && 'bg-navy-900/95 text-white ring-navy-900/30',
            )}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>
                {t.tone === 'success' ? '✓' : t.tone === 'error' ? '!' : 'i'}
              </span>
              <span className="leading-6">{t.message}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => undefined,
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
    };
  }
  return ctx;
}
