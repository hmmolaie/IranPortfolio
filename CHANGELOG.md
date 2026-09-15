# Changelog

فرمت بر پایهٔ [Keep a Changelog](https://keepachangelog.com/fa/1.1.0/).
نسخه‌دهی معنایی: [SemVer](https://semver.org/lang/fa/).

## [Unreleased]

### Added

- آزمایش گراف فارکس در `/forex`: سود خالص پس از اسپرد، کمیسیون، لغزش، سواپ و تأخیر اجرا؛ پیشنهاد معامله فقط اگر خالص مثبت باشد
- گفتگوی LLM در صفحهٔ بازار سهام تهران: فقط نماد/شاخص بورس تهران با دادهٔ قیمت و صندوق‌هایی که سهم را خریده‌اند
- اقتصاد دنیا: همگام‌سازی بیت‌پین به‌علاوه ۵ سیگنال قوی خرید/فروش از فضای X به همهٔ زبان‌ها روی همان نمادها
- قیمت دلار آزاد و طلای ۱۸ عیار از بیت‌پین (تتر و انس طلای دیجیتال) در اقتصاد ایران
- جمع‌آوری خودکار اخبار و فرصت‌های خرد مؤثر بر سبد، هر روز ۸ صبح به وقت ایران
- ربات تلگرام ۸:۳۰ از [`https://t.me/sabadyaar_bot`](https://t.me/sabadyaar_bot): نمودار سبد جاری، پیشنهاد بهبود با دادهٔ بورس/ارز/اخبار، و فرصت‌های خرد
- GitHub Actions: استقرار خودکار سرور تست (`.github/workflows/deploy-test.yml`) + اسکریپت `scripts/deploy-test-server.sh`
- استک کامل Docker (`docker-compose.yml` + `Dockerfile.api` / `Dockerfile.web`) برای دسترسی از راه دور
- نمونه env سرور: `docker/env.production.example` (IP پیش‌فرض `46.249.100.230`)
- مستندات استاندارد مخزن: `AGENTS.md`، `ARCHITECTURE.md`، `CONTRIBUTING.md`، `SECURITY.md`

### Changed

- Prisma datasource پیش‌فرض: PostgreSQL (هماهنگ با Docker)

## [0.1.0] — 2026-08

### Added

- مونوریپو اولیه: وب Next.js، API NestJS+Prisma، پکیج shared
- احراز هویت چندکاربره و سبدهای جدا
- پیشنهاد/بازچینش سبد با LLM، بازار، صندوق‌ها، کلان، درس‌آموخته‌ها
- SQLite برای توسعه؛ Docker Compose برای PostgreSQL اختیاری
