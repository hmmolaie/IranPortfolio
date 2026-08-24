# سبدیار (Sabadyar)

پلتفرم فارسی و راست‌به‌چپ (`dir="rtl"`) برای کشف و مدیریت سبد سرمایه‌گذاری در بازار ایران.

## پشته فنی

- **وب:** Next.js + React + Tailwind (RTL کامل)
- **API:** NestJS + Prisma
- **دیتابیس:** SQLite برای توسعه محلی (اختیاری PostgreSQL با Docker)

## راه‌اندازی

```bash
cp .env.example .env
cp .env.example apps/api/.env
npm install
cd apps/api && npx prisma db push && cd ../..
npm run dev:api
# ترمینال دیگر:
npm run dev:web
```

- وب: http://localhost:3000  
- API: http://localhost:3001  

### PostgreSQL (اختیاری)

```bash
docker compose -f docker/docker-compose.yml up -d
```

سپس در `apps/api/prisma/schema.prisma` مقدار `provider` را به `postgresql` برگردانید و `DATABASE_URL` را مطابق `.env.example` تنظیم کنید.

## امکانات

- ثبت‌نام چندکاربره و سبدهای جدا
- جمع‌آوری روزانه قیمت / EPS / P/E از TSETMC
- پیشنهاد سبد با LLM (سازگار با ChatGPT) + ذخیره چرایی هر آیتم
- ویرایش وزن، واریز/فروش و بازچینش
- آپلود PDF صندوق‌ها، امتیازدهی استراتژی و درس‌آموخته‌ها
- زمینه اقتصاد ایران (تورم، بهره، ریسک ژئوپلیتیک)
- دارایی‌ها: سهام، طلا، سپرده، اختیار فعال

**توجه:** خروجی سایت مشاوره سرمایه‌گذاری رسمی نیست.
