import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'سبدیار | کشف سبد بهینه بازار ایران',
  description: 'پلتفرم فارسی مدیریت و پیشنهاد سبد سرمایه‌گذاری برای بازار ایران',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
