# Changelog

فرمت بر پایهٔ [Keep a Changelog](https://keepachangelog.com/fa/1.1.0/).
نسخه‌دهی معنایی: [SemVer](https://semver.org/lang/fa/).

## [Unreleased]

### Added

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
