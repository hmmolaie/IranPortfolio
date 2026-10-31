import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  metadataBase: new URL('https://sabad-yar.ir'),
  title: 'پیپ | پلتفرم بینش‌های هوشمند سرمایه‌گذاری شخصی',
  description: 'پلتفرم بینش‌های هوشمند سرمایه‌گذاری شخصی برای بازار ایران',
  appleWebApp: {
    capable: true,
    title: 'پیپ',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' }],
  },
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
