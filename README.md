#this is hamid
# سبدیار (Sabadyar)

پلتفرم فارسی و راست‌به‌چپ (`dir="rtl"`) برای کشف و مدیریت سبد سرمایه‌گذاری در بازار ایران.

## پشته فنی

- **وب:** Next.js + React + Tailwind (RTL کامل)
- **API:** NestJS + Prisma
- **دیتابیس:** PostgreSQL (Docker) — برای توسعهٔ بدون Docker می‌توانید موقتاً SQLite بگذارید

## اجرای کامل با Docker (توصیه‌شده روی سرور)

روی سرور لینوکس (دسترسی از راه دور روی `46.249.100.230`):

```bash
cp docker/env.production.example .env
# در صورت نیاز JWT_SECRET و رمز Postgres را عوض کنید
docker compose up -d --build
```

- وب: http://46.249.100.230:3000  
- API: http://46.249.100.230:3001  

فایروال باید پورت‌های `3000` و `3001` را باز کند. دیتابیس فقط داخل شبکهٔ Docker است و روی اینترنت expose نمی‌شود.

توقف:

```bash
docker compose down
```

لاگ‌ها:

```bash
docker compose logs -f web api
```

همان استک با مسیر قدیمی هم در دسترس است: `docker compose -f docker/docker-compose.yml up -d --build`

### استقرار خودکار با GitHub Actions

با push به `main`، workflow `.github/workflows/deploy-test.yml` روی سرور تست pull و `docker compose up -d --build` می‌زند.

راه‌اندازی secrets و آماده‌سازی سرور: [`CONTRIBUTING.md`](./CONTRIBUTING.md#استقرار-خودکار-github-actions).

## راه‌اندازی بدون Docker (توسعه)

```bash
cp .env.example .env
cp .env.example apps/api/.env
# Postgres محلی لازم است؛ یا provider را در schema به sqlite برگردانید
npm install
npm run db:push
npm run dev:api
# ترمینال دیگر:
npm run dev:web
```

- وب: http://localhost:3000  
- API: http://localhost:3001  

## امکانات

- ثبت‌نام چندکاربره و سبدهای جدا
- جمع‌آوری روزانه قیمت / EPS / P/E از TSETMC
- پیشنهاد سبد با LLM (سازگار با ChatGPT) + ذخیره چرایی هر آیتم
- ویرایش وزن، واریز/فروش و بازچینش
- آپلود PDF صندوق‌ها، امتیازدهی استراتژی و درس‌آموخته‌ها
- زمینه اقتصاد ایران (تورم، بهره، ریسک ژئوپلیتیک)
- دارایی‌ها: سهام، طلا، سپرده، اختیار فعال

**توجه:** خروجی سایت مشاوره سرمایه‌گذاری رسمی نیست.

## مستندات

| فایل | موضوع |
|------|--------|
| [AGENTS.md](./AGENTS.md) | راهنمای ایجنت‌های کدنویسی (Cursor و سازگار) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | معماری مونوریپو و جریان‌های اصلی |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | راه‌اندازی و قرارداد مشارکت |
| [SECURITY.md](./SECURITY.md) | اسرار، گزارش آسیب‌پذیری، مسئولیت محصول |
| [CHANGELOG.md](./CHANGELOG.md) | تاریخچهٔ نسخه‌ها |
| [docker/env.production.example](./docker/env.production.example) | نمونه env برای سرور |
