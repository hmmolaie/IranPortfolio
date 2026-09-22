'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isMobileDevice } from '@/lib/webauthn';

const HIDE_KEY = 'sabadyar_install_prompt_hidden';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Guide = 'ios' | 'manual' | null;

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
}

function hideForever() {
  localStorage.setItem(HIDE_KEY, '1');
}

export function InstallAppPrompt() {
  const pathname = usePathname();
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [guide, setGuide] = useState<Guide>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pathname !== '/') return;
    if (!isMobileDevice() || isStandalone()) return;
    if (localStorage.getItem(HIDE_KEY) === '1') return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferredRef.current = event as BeforeInstallPromptEvent;
    };
    const onInstalled = () => {
      hideForever();
      setOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    navigator.serviceWorker?.register('/sw.js').catch(() => undefined);

    const timer = window.setTimeout(() => {
      if (localStorage.getItem(HIDE_KEY) === '1' || isStandalone()) return;
      setOpen(true);
    }, 800);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [pathname]);

  if (!open || pathname !== '/') return null;

  async function install() {
    const deferred = deferredRef.current;
    if (!deferred) {
      setGuide(isIos() ? 'ios' : 'manual');
      return;
    }
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferredRef.current = null;
      if (choice.outcome === 'accepted') {
        hideForever();
        setOpen(false);
      }
    } catch {
      setGuide(isIos() ? 'ios' : 'manual');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
  }

  function toggleDontShow(checked: boolean) {
    setDontShow(checked);
    if (checked) hideForever();
    else localStorage.removeItem(HIDE_KEY);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <section className="pointer-events-auto w-full max-w-sm rounded-2xl border border-navy-900/10 bg-white/95 p-4 shadow-soft backdrop-blur">
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900"
            aria-hidden
          >
            <span className="block h-5 w-5 rounded-full border-[3px] border-gold-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-navy-900">نصب پیپ روی گوشی</h2>
            <p className="mt-1 text-xs leading-6 text-navy-800/70">
              پیپ را مثل یک اپ روی صفحهٔ اصلی بگذارید تا دفعهٔ بعد مستقیم باز شود.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-navy-800/45 hover:bg-navy-50 hover:text-navy-900"
            onClick={close}
            aria-label="بستن"
          >
            ×
          </button>
        </div>

        {guide === 'ios' && (
          <p className="mt-3 rounded-xl bg-navy-50 px-3 py-2 text-xs leading-6 text-navy-800/80">
            دکمهٔ اشتراک را در پایین مرورگر بزنید، بعد «افزودن به صفحهٔ اصلی» را انتخاب کنید.
          </p>
        )}
        {guide === 'manual' && (
          <p className="mt-3 rounded-xl bg-navy-50 px-3 py-2 text-xs leading-6 text-navy-800/80">
            از منوی مرورگر گزینهٔ «نصب برنامه» یا «افزودن به صفحهٔ اصلی» را بزنید.
          </p>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-navy-800/70">
          <input
            type="checkbox"
            className="h-4 w-4 accent-navy-900"
            checked={dontShow}
            onChange={(e) => toggleDontShow(e.target.checked)}
          />
          این پیام را دیگر نشان نده
        </label>

        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary flex-1 !px-3 !py-2 text-xs" disabled={busy} onClick={install}>
            {busy ? 'در حال نصب...' : 'نصب'}
          </button>
          <button type="button" className="btn-secondary flex-1 !px-3 !py-2 text-xs" onClick={close}>
            بعداً
          </button>
        </div>
      </section>
    </div>
  );
}
