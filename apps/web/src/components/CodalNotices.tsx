'use client';

import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type CodalNotice = {
  tracingNo: number;
  titleFa: string;
  letterCode: string | null;
  publishedAtFa: string;
  url: string;
  hasHtml: boolean;
  bodyText: string | null;
};

type CodalNoticesDto = {
  symbol: string;
  supported: boolean;
  sourceUrl: string | null;
  fetchedAt: string | null;
  stale: boolean;
  errorFa: string | null;
  items: CodalNotice[];
};

/** متن بلندتر از این اندازه جمع می‌شود و با دکمه باز می‌شود */
const COLLAPSED_CHARS = 420;

function fetchedLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function CodalNotices({ instrumentId }: { instrumentId: string }) {
  const [data, setData] = useState<CodalNoticesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let stopped = false;
    setData(null);
    setFailed(false);
    setLoading(true);
    setOpen({});
    api<CodalNoticesDto>(`/market/instruments/${instrumentId}/codal`)
      .then((res) => {
        if (!stopped) setData(res);
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [instrumentId]);

  if (data && !data.supported) return null;

  const fetched = fetchedLabel(data?.fetchedAt ?? null);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-navy-900">اطلاعیه‌های کدال</h2>
        {data && (
          <p className="mt-2 text-sm text-navy-800/70">
            {fetched ? `آخرین واکشی از کدال: ${fetched}.` : ''}
            {data.stale ? ' این فهرست از واکشی قبلی است.' : ''}
            {data.sourceUrl && (
              <>
                {' '}
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-navy-900 underline"
                >
                  همهٔ اطلاعیه‌ها در کدال
                </a>
              </>
            )}
          </p>
        )}
      </div>

      {loading && (
        <p role="status" className="flex items-center gap-3 text-sm text-navy-800/60">
          <span className="flex items-center gap-1" aria-hidden>
            <span className="h-2 w-2 animate-bounce rounded-full bg-navy-900/50 [animation-delay:-0.3s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-navy-900/50 [animation-delay:-0.15s]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-navy-900/50" />
          </span>
          در حال خواندن اطلاعیه‌ها از کدال؛ بار اول در هر روز چند ثانیه طول می‌کشد...
        </p>
      )}
      {failed && <p className="text-sm text-red-700">خواندن اطلاعیه‌های کدال ناموفق بود.</p>}
      {data?.errorFa && <p className="text-sm text-red-700">{data.errorFa}</p>}

      {data && data.items.length === 0 && !data.errorFa && (
        <p className="text-sm text-navy-800/60">برای این نماد اطلاعیه‌ای در کدال پیدا نشد.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-navy-900/10 text-right text-xs text-navy-800/50">
                <th className="px-2 py-2 font-medium">عنوان اطلاعیه</th>
                <th className="px-2 py-2 font-medium">کد</th>
                <th className="px-2 py-2 font-medium">زمان انتشار</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const body = row.bodyText ?? '';
                const long = body.length > COLLAPSED_CHARS;
                const expanded = open[row.tracingNo] === true;
                const shownText = long && !expanded ? `${body.slice(0, COLLAPSED_CHARS)}…` : body;
                return (
                  <Fragment key={row.tracingNo}>
                    <tr className={body ? '' : 'border-b border-navy-900/5'}>
                      <td className="px-2 py-2.5">
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-navy-900 hover:underline"
                        >
                          {row.titleFa}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-navy-800/60">
                        {row.letterCode ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-navy-800/70">
                        {row.publishedAtFa || '—'}
                      </td>
                    </tr>
                    {body && (
                      <tr className="border-b border-navy-900/5">
                        <td colSpan={3} className="px-2 pb-3">
                          <div className="whitespace-pre-line rounded-lg bg-navy-50/60 p-3 text-sm leading-7 text-navy-800/80">
                            {shownText}
                          </div>
                          {long && (
                            <button
                              type="button"
                              className="mt-2 text-xs text-navy-900 underline"
                              onClick={() =>
                                setOpen((prev) => ({ ...prev, [row.tracingNo]: !expanded }))
                              }
                            >
                              {expanded ? 'نمایش کمتر' : 'نمایش کامل متن'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
