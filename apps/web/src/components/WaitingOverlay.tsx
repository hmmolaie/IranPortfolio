'use client';

import { useEffect, useState } from 'react';

type Props = {
  title: string;
  description: string;
  steps: string[];
};

export function WaitingOverlay({ title, description, steps }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!steps.length) return;
    const id = window.setInterval(() => {
      setStep((s) => (s + 1) % steps.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [steps]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/55 p-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-navy-900/10 bg-cream px-6 py-8 shadow-soft">
        <div
          aria-hidden
          className="pointer-events-none absolute -start-16 -top-16 h-40 w-40 rounded-full bg-gold-400/25 blur-2xl animate-pulse"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -end-10 h-44 w-44 rounded-full bg-navy-900/10 blur-2xl animate-pulse"
          style={{ animationDelay: '0.6s' }}
        />

        <div className="relative flex flex-col items-center text-center">
          <div className="relative mb-6 h-20 w-20">
            <span className="absolute inset-0 rounded-full border-2 border-navy-900/10" />
            <span className="portfolio-create-ring absolute inset-0 rounded-full border-2 border-transparent border-t-navy-900 border-e-gold-500" />
            <span className="portfolio-create-orbit absolute inset-2 rounded-full border border-dashed border-gold-500/40" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="portfolio-create-dot h-3 w-3 rounded-full bg-gold-500" />
            </span>
          </div>

          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <p className="mt-2 text-sm leading-7 text-navy-800/75">{description}</p>

          {steps.length > 0 && (
            <div className="mt-5 flex min-h-[1.75rem] items-center justify-center gap-2">
              <span className="flex gap-1" aria-hidden>
                <span className="portfolio-create-bounce h-1.5 w-1.5 rounded-full bg-navy-900" />
                <span
                  className="portfolio-create-bounce h-1.5 w-1.5 rounded-full bg-navy-900"
                  style={{ animationDelay: '0.15s' }}
                />
                <span
                  className="portfolio-create-bounce h-1.5 w-1.5 rounded-full bg-gold-500"
                  style={{ animationDelay: '0.3s' }}
                />
              </span>
              <span key={step} className="portfolio-create-fade text-sm font-medium text-navy-800">
                {steps[step]}
              </span>
            </div>
          )}

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-navy-900/10">
            <div className="portfolio-create-bar h-full rounded-full bg-gradient-to-l from-navy-900 via-gold-500 to-navy-900" />
          </div>
        </div>
      </div>
    </div>
  );
}
