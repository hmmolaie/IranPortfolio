import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'پلتفرم بینش‌های هوشمند سرمایه‌گذاری شخصی',
    short_name: 'پیپ',
    description: 'پلتفرم بینش‌های هوشمند سرمایه‌گذاری شخصی برای بازار ایران',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fa',
    dir: 'rtl',
    background_color: '#f3eee6',
    theme_color: '#08131f',
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
