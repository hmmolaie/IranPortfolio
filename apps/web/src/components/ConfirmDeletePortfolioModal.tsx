'use client';

type Props = {
  portfolioName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDeletePortfolioModal({
  portfolioName,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-portfolio-title"
    >
      <div className="card w-full max-w-md space-y-4 shadow-soft">
        <h2 id="delete-portfolio-title" className="text-lg font-semibold text-navy-900">
          تأیید حذف سبد
        </h2>
        <p className="leading-7 text-navy-800/80">
          آیا مطمئن هستید که می‌خواهید سبد{' '}
          <strong className="text-navy-900">«{portfolioName}»</strong> را کاملاً حذف کنید؟
        </p>
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-6 text-red-800">
          این عمل برگشت‌ناپذیر است. همهٔ ترکیب‌ها، رویدادها، گفتگوها و پیشنهادهای این سبد حذف می‌شوند.
        </p>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            انصراف
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-red-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-800 disabled:opacity-50"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'در حال حذف...' : 'تأیید نهایی حذف'}
          </button>
        </div>
      </div>
    </div>
  );
}
