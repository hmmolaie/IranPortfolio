'use client';

type Step = { title: string; body: string; done: boolean; action?: { label: string; busyLabel: string; busy: boolean; onClick: () => void } };

/** راهنمای سبدی که کاربر از دارایی‌های فعلی‌اش ثبت کرده: ثبت، آنالیز، بازچینش. */
export function ImportGuide({
  analyzed,
  rebalanced,
  busy,
  onAnalyze,
  onRebalance,
  onClose,
}: {
  analyzed: boolean;
  rebalanced: boolean;
  busy: string;
  onAnalyze: () => void;
  onRebalance: () => void;
  onClose: () => void;
}) {
  const steps: Step[] = [
    { title: 'سبد فعلی ثبت شد', body: 'دارایی‌ها با آخرین قیمت روز ارزش‌گذاری شدند.', done: true },
    {
      title: 'آنالیز با هوش مصنوعی',
      body: 'امتیاز سبد، نقاط قوت و ضعف و پیشنهاد اصلاح هر دارایی.',
      done: analyzed,
      action: { label: 'شروع آنالیز', busyLabel: 'در حال آنالیز…', busy: busy === 'analyze', onClick: onAnalyze },
    },
    {
      title: 'بازچینش با هوش مصنوعی',
      body: 'سبد بر اساس هدف شما و وضعیت بازار دوباره چیده می‌شود. می‌توانید فقط پیشنهادهای آنالیز را هم یکی‌یکی اعمال کنید.',
      done: rebalanced,
      action: { label: 'بازچینش سبد', busyLabel: 'در حال بازچینش…', busy: busy === 'rebalance', onClick: onRebalance },
    },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <section className="card space-y-4 border-gold-400/50">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">قدم‌های بعدی سبد شما</h2>
        {current === -1 && (
          <button type="button" className="text-sm text-navy-800/60 hover:underline" onClick={onClose}>
            بستن
          </button>
        )}
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => {
          const active = index === current;
          const locked = current !== -1 && index > current;
          return (
            <li
              key={step.title}
              className={`flex flex-col gap-3 rounded-xl border p-4 transition ${
                step.done
                  ? 'border-emerald-600/30 bg-emerald-50/60'
                  : active
                    ? 'border-gold-500 bg-gold-400/10 shadow-soft'
                    : 'border-navy-900/10 opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    step.done ? 'bg-emerald-600 text-white' : active ? 'bg-navy-900 text-white' : 'bg-navy-900/10 text-navy-800'
                  }`}
                >
                  {step.done ? '✓' : (index + 1).toLocaleString('fa-IR')}
                </span>
                <span className="font-semibold">{step.title}</span>
              </div>
              <p className="text-sm leading-7 text-navy-800/65">{step.body}</p>
              {step.action && !step.done && (
                <button
                  type="button"
                  className={active ? 'btn-primary mt-auto w-fit' : 'btn-secondary mt-auto w-fit'}
                  disabled={locked || !!busy}
                  onClick={step.action.onClick}
                >
                  {step.action.busy ? step.action.busyLabel : step.action.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
