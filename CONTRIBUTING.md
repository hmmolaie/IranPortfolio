# مشارکت در سبدیار

## پیش‌نیاز

- Node.js 20+
- npm (workspaces)
- اختیاری: Docker برای PostgreSQL

## راه‌اندازی

```bash
cp .env.example .env
cp .env.example apps/api/.env
npm install
npm run db:push
npm run dev:api   # ترمینال ۱
npm run dev:web   # ترمینال ۲
```

جزئیات بیشتر: [`README.md`](./README.md).

## ساختار کار

1. از شاخهٔ به‌روز `main` (یا شاخهٔ پایهٔ تیم) شروع کنید.
2. شاخهٔ کوتاه و توصیفی بسازید، مثلاً `feat/portfolio-cash` یا `fix/market-ingest`.
3. تغییرات کوچک و متمرکز نگه دارید.
4. قبل از PR: `npm run build` و مسیرهای مرتبط را دستی تست کنید.

## قراردادها

- UI و پیام‌های کاربر: **فارسی + RTL**.
- انواع مشترک: فقط در `packages/shared`؛ سپس بیلد پکیج.
- اسکیما: تغییر Prisma را با generate/push یا migrate همراه کنید.
- اسرار و `.env` را commit نکنید.
- کامیت‌ها را کوتاه و با تمرکز بر «چرا» بنویسید.

## محدودهٔ PR

- یک موضوع در هر PR ترجیح داده می‌شود.
- در توضیح PR: خلاصهٔ تغییر + نحوهٔ تست.
- اگر رفتار مالی/پیشنهاد LLM عوض می‌شود، نمونه ورودی/خروجی یا اسکرین را ذکر کنید.

## استقرار خودکار (GitHub Actions)

با هر push به `main`، workflow زیر روی سرور تست اجرا می‌شود:

`.github/workflows/deploy-test.yml`

### Secrets در GitHub

در مخزن:

```
Settings → Secrets and variables → Actions → New repository secret
```

| Secret | توضیح |
|--------|--------|
| `SSH_HOST` | IP یا دامنه سرور (مثلاً `46.249.100.230`) |
| `SSH_USER` | کاربر SSH |
| `SSH_PRIVATE_KEY` | کلید خصوصی SSH (بدون passphrase ترجیحاً) |
| `DEPLOY_PATH` | مسیر clone پروژه روی سرور (مثلاً `/home/ubuntu/IranPortfolio`) |
| `SSH_PORT` | اختیاری؛ پیش‌فرض `22` |

### آماده‌سازی یک‌بار روی سرور

```bash
git clone <repo-url> ~/IranPortfolio
cd ~/IranPortfolio
cp docker/env.production.example .env
# ویرایش .env (JWT، Postgres، LLM، BRS_API_KEY)
docker compose up -d --build
```

اگر کاربر deploy عضو گروه `docker` نیست، workflow خودکار `sudo docker compose` را امتحان می‌کند.

استقرار دستی (بدون Actions):

```bash
bash scripts/deploy-test-server.sh
```

## مستندات مرتبط

- [`AGENTS.md`](./AGENTS.md) — راهنمای ایجنت‌ها
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — معماری
- [`SECURITY.md`](./SECURITY.md) — امنیت
