# AGENTS.md — سبدیار (Sabadyar)

دستورالعمل برای ایجنت‌های کدنویسی. جزئیات انسانی در `README.md` و `ARCHITECTURE.md`.

## پروژه چیست

مونوریپو npm برای پلتفرم فارسی/RTL مدیریت سبد سرمایه‌گذاری بازار ایران. خروجی مشاوره رسمی نیست.

| مسیر | نقش |
|------|-----|
| `apps/web` | Next.js 15 + React 19 + Tailwind (`@sabadyar/web`) |
| `apps/api` | NestJS 11 + Prisma (`@sabadyar/api`) — پیشوند `/api` |
| `packages/shared` | انواع و لیبل‌های مشترک (`@sabadyar/shared`) |
| `docker/` | PostgreSQL اختیاری |

## دستورات

```bash
cp .env.example .env && cp .env.example apps/api/.env
npm install
npm run db:push          # یا: cd apps/api && npx prisma db push
npm run dev:api          # :3001
npm run dev:web          # :3000
npm run build
```

Node `>=20`. دیتابیس پیش‌فرض SQLite (`apps/api/prisma`).

## قواعد اجباری

1. **UI همیشه فارسی و RTL** — `lang="fa"` و `dir="rtl"`؛ متن کاربر به فارسی.
2. **انواع مشترک** را در `packages/shared` نگه دار؛ بعد از تغییر، پکیج را بیلد کن.
3. **Prisma schema** منبع حقیقت مدل‌هاست؛ بعد از تغییر: `db:generate` و در صورت نیاز `db:push` / migrate.
4. **اسرار را کامیت نکن** — `.env`، توکن LLM، `JWT_SECRET`. فقط `.env.example` را به‌روز کن.
5. **دامنه محدود** — فقط همان فایل/ماژول مرتبط را تغییر بده؛ ریفکتور گسترده بدون درخواست نکن.
6. **اعتبارسنجی API** — DTO + `ValidationPipe` (whitelist / forbidNonWhitelisted).
7. **مسیر وب** — کلاینت از `apps/web/src/lib/api.ts` با `Authorization: Bearer` و پایه `NEXT_PUBLIC_API_URL` استفاده می‌کند.

## ماژول‌های API

`auth` · `users` · `market` · `portfolios` · `llm` · `funds` · `macro` · `lessons`

اندپوینت‌های مهم سبد: `POST :id/suggest` · `rebalance` · `monthly-evaluate` · `adjust` · `cash`.

## سبک کد

- TypeScript سخت‌گیر؛ بدون `any` غیرضروری.
- Nest: ماژول / کنترلر / سرویس جدا؛ گارد JWT برای مسیرهای خصوصی.
- Next: App Router؛ صفحات در `apps/web/src/app`.
- اعداد پولی با `formatRial` / `formatNum` (locale `fa-IR`).
- کامیت فقط با درخواست کاربر؛ پیام کوتاه و «چرا»محور.

## امنیت و دامنه

- توکن LLM کاربر رمزنگاری‌شده ذخیره می‌شود (`LLM_TOKEN_ENCRYPTION_KEY`).
- اسکرپ/اینجست بازار (TSETMC) را بدون بررسی اثر جانبی تغییر نده.
- ادعاهای سرمایه‌گذاری قطعی یا توصیهٔ مالی رسمی نساز.
