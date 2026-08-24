'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';

type Lesson = {
  id: string;
  titleFa: string;
  bodyFa: string;
  source?: string | null;
  createdAt: string;
};

export default function LessonsPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<Lesson[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    api<Lesson[]>('/lessons').then(setLessons).catch(() => undefined);
  }, [router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">درس‌آموخته‌ها</h1>
        <p className="mt-2 text-navy-800/70">یادداشت‌های استخراج‌شده از صندوق‌ها و ارزیابی ماهانه</p>
      </div>
      <div className="space-y-4">
        {lessons.map((l) => (
          <article key={l.id} className="card">
            <h2 className="text-lg font-semibold">{l.titleFa}</h2>
            <p className="mt-2 leading-7 text-navy-800/80">{l.bodyFa}</p>
            <p className="mt-3 text-xs text-navy-800/40">
              {l.source} · {new Date(l.createdAt).toLocaleDateString('fa-IR')}
            </p>
          </article>
        ))}
        {lessons.length === 0 && <p className="card text-sm text-navy-800/60">هنوز درس‌آموخته‌ای ثبت نشده است.</p>}
      </div>
    </div>
  );
}
