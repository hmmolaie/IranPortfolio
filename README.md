#this is hamid
# سبدیار (Sabadyar)

پلتفرم فارسی و راست‌به‌چپ (`dir="rtl"`) برای کشف و مدیریت سبد سرمایه‌گذاری در بازار ایران.

دامنهٔ عمومی:

```
https://sabad-yar.ir
```

API پشت همان دامنه:

```
https://sabad-yar.ir/api
```

## پشته فنی

- **وب:** Next.js + React + Tailwind (RTL کامل)
- **API:** NestJS + Prisma
- **دیتابیس:** PostgreSQL (Docker) — برای توسعهٔ بدون Docker می‌توانید موقتاً SQLite بگذارید
- **ورود عمومی:** Nginx reverse proxy (فقط پورت ۸۰ و ۴۴۳)

## اجرای کامل با Docker (توصیه‌شده روی سرور)

روی سرور لینوکس، DNS دامنه را به IP سرور بدهید، سپس:

```bash
cp docker/env.production.example .env
# در صورت نیاز JWT_SECRET و رمز Postgres را عوض کنید
docker compose up -d --build
```

- سایت:

```
https://sabad-yar.ir
```

- API:

```
https://sabad-yar.ir/api
```

فایروال فقط پورت‌های `80` و `443` را باز کند. سرویس‌های `web` (۳۰۰۰) و `api` (۳۰۰۱) داخل شبکهٔ Docker می‌مانند و روی اینترنت publish نمی‌شوند. دیتابیس هم فقط داخلی است.

برای HTTPS، گواهی را در این مسیر بگذارید (در غیر این صورت سایت روی HTTP پورت ۸۰ کار می‌کند):

```
docker/nginx/certs/fullchain.pem
docker/nginx/certs/privkey.pem
```

سپس nginx را یک‌بار از نو بالا بیاورید:

```bash
docker compose up -d nginx
```

توقف:

```bash
docker compose down
```

لاگ‌ها:

```bash
docker compose logs -f nginx web api
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
- API: http://localhost:3001 (فقط روی localhost گوش می‌دهد)

## امکانات

- ثبت‌نام چندکاربره و سبدهای جدا
- ورود با رمز عبور؛ روی موبایل اثر انگشت یا تشخیص چهره (پس از یک‌بار فعال‌سازی)
- جمع‌آوری روزانه قیمت / EPS / P/E از TSETMC
- اقتصاد دنیا (ادمین): همهٔ نمادهای بیت‌پین هر روز ۷ صبح؛ همان به‌روزرسانی ۵ سیگنال قوی خرید/فروش از فضای X را هم می‌نویسد
- اخبار و فرصت‌های قابل اقدام خرد، هر روز ۸ صبح؛ پیام تلگرام ۸:۳۰ از ربات

```
https://t.me/sabadyaar_bot
```

- پیشنهاد سبد با LLM (سازگار با ChatGPT) + ذخیره چرایی هر آیتم
- ویرایش وزن، واریز/فروش و بازچینش
- آپلود PDF صندوق‌ها، امتیازدهی استراتژی و درس‌آموخته‌ها
- آپلود PDF اقتصاد ایران در درس‌آموخته‌ها و استخراج درس برای پیشنهاد سبد
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
