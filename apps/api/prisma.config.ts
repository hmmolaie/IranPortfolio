import { defineConfig } from 'prisma/config';

// Prisma 7 دیگر فایل .env را خودش نمی‌خواند. در Docker متغیرها از compose می‌آید و فایلی نیست.
try {
  process.loadEnvFile();
} catch {
  // بدون فایل .env همان متغیرهای محیط استفاده می‌شود
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // prisma generate هنگام ساخت ایمیج بدون DATABASE_URL اجرا می‌شود و نباید خطا بدهد
    url: process.env.DATABASE_URL ?? '',
  },
});
