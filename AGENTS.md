# AGENTS.md — سبدیار (Sabadyar)

دستورالعمل برای ایجنت‌های کدنویسی. جزئیات انسانی در `README.md` و `ARCHITECTURE.md`.

## پروژه چیست

مونوریپو npm برای پلتفرم فارسی/RTL مدیریت سبد سرمایه‌گذاری بازار ایران. خروجی مشاوره رسمی نیست.

| مسیر | نقش |
|------|-----|
| `apps/web` | Next.js 15 + React 19 + Tailwind (`@sabadyar/web`) |
| `apps/api` | NestJS 11 + Prisma (`@sabadyar/api`) — پیشوند `/api` |
| `packages/shared` | انواع و لیبل‌های مشترک (`@sabadyar/shared`) |
| `docker/` | Dockerfileهای api/web، nginx reverse proxy، و نمونه env سرور |
| `docker-compose.yml` | استک کامل: nginx + web + api + postgres |

## دستورات

```bash
# سرور / production
cp docker/env.production.example .env
docker compose up -d --build

# توسعه بدون Docker
cp .env.example .env && cp .env.example apps/api/.env
npm install
npm run db:push
npm run dev:api          # :3001
npm run dev:web          # :3000
npm run build
```

Node `>=20`. با Docker دیتابیس PostgreSQL است. کلاینت وب API را از همان origin صفحه روی مسیر `/api` صدا می‌زند (بدون پورت ۳۰۰۱). `CORS_ORIGIN` باید دامنه یا IP عمومی بدون پورت باشد.

## محیط کار ایجنت

این workspace فقط برای نوشتن کد است. بیلد، تست و اجرا روی سرور/محیط تست کاربر انجام می‌شود؛ ایجنت نباید اینجا `npm run build` یا تست runtime بزند مگر درخواست صریح.

## قواعد اجباری

1. **UI همیشه فارسی و RTL** — `lang="fa"` و `dir="rtl"`؛ متن کاربر به فارسی.
2. **پاسخ‌های ایجنت** — فارسی RTL؛ URL، دستور و شناسهٔ انگلیسی در خط/بلوک جدا (نه وسط جمله).
2. **انواع مشترک** را در `packages/shared` نگه دار؛ بعد از تغییر، پکیج را بیلد کن.
3. **Prisma schema** منبع حقیقت مدل‌هاست؛ بعد از تغییر: `db:generate` و در صورت نیاز `db:push` / migrate.
4. **اسرار را کامیت نکن** — `.env`، توکن LLM، `JWT_SECRET`. فقط `.env.example` را به‌روز کن.
5. **دامنه محدود** — فقط همان فایل/ماژول مرتبط را تغییر بده؛ ریفکتور گسترده بدون درخواست نکن.
6. **اعتبارسنجی API** — DTO + `ValidationPipe` (whitelist / forbidNonWhitelisted).
7. **مسیر وب** — کلاینت از `apps/web/src/lib/api.ts` با `Authorization: Bearer` به `/api` روی همان origin صفحه درخواست می‌زند (نه پورت ۳۰۰۱).

## ماژول‌های API

`auth` · `users` · `market` · `portfolios` · `llm` · `funds` · `macro` · `news` · `prices` · `telegram` · `telegram-assistant` · `world-markets` · `lessons` · `forex`

اندپوینت‌های مهم سبد: `POST :id/suggest` · `rebalance` · `monthly-evaluate` · `adjust` · `cash` · `POST/PATCH/DELETE :id/items` (افزودن/ویرایش با تعداد یا مبلغ، نه وزن٪) · `POST :id/apply-suggestion` (اعمال یک پیشنهاد آنالیز).
ورود: `POST /api/auth/login` با رمز؛ روی موبایل `POST /api/auth/webauthn/*` برای اثر انگشت یا چهره (کلید عبور دستگاه).
گفتگوی سبد (`GET/POST/DELETE :id/chat`): ترکیب سبد به‌علاوه وضعیت سهام/دلار/طلا از دیتابیس، حتی اگر در سبد نباشد.
بازار تهران: گفتگوی LLM در `GET/POST/DELETE /api/market/chat`؛ فقط نماد/شاخص بورس تهران و خرید صندوق‌ها از دیتابیس.
آزمایش فارکس: گراف جفت‌ارز در `GET/POST /api/forex` و صفحهٔ `/forex` فقط برای admin؛ پیشنهاد معامله فقط اگر سود خالص پس از هزینه مثبت باشد.
اخبار روزانه: کرون ۸ صبح تهران در `news` (`POST /api/news/refresh` دستی برای admin) با Grok و ابزار `x_search` روی کل X به هر زبان؛ حداکثر ۷ خبر اثرگذار بر اقتصاد ایران و حداکثر ۳ فرصت سرمایه‌گذاری ذخیره می‌شود و در پیشنهاد/بهبود سبد می‌آید.
اقتصاد دنیا: کرون ۷ صبح تهران در `world-markets` (`POST /api/world-markets/refresh` دستی برای admin)؛ قیمت رمزارز با یاهو فایننس مقایسه می‌شود. همان به‌روزرسانی (خودکار یا فوری) حداکثر ۵ خبر کلان اقتصاد جهان و آمریکا اثرگذار بر نفت/طلا/دلار/فلزات/رمزارز را با پرامپت `world_macro_news` از رسانه‌های معتبر می‌خواند، در `WorldMacroNews` ذخیره و در صفحهٔ `/world` نشان می‌دهد؛ `iranImpactFa` در پیشنهاد و آنالیز سبد لحاظ می‌شود و درس پایدار به `Lesson` با منبع `world_macro_news:<dateKey>` اضافه می‌شود.
تلگرام: ربات عمومی `https://t.me/sabadyaar_bot`؛ تنظیمات ادمین در `telegram`؛ پیام زمان‌بندی‌شده به کاربرانی که موبایل پروفایل دارند و ربات را وصل کرده‌اند. روزها و ساعت از `sendWeekdays` / `sendHour` / `sendMinute` در تنظیمات ربات است (پیش‌فرض هر روز ۸:۳۰ تهران؛ تلاش مجدد ۱۵ دقیقه بعد). اخبار و متن/صوت مشترک هر روز فقط یک‌بار از مدل ساخته می‌شود و برای همه فرستاده می‌شود؛ برای هر کاربر فقط سبد فعلی و پیشنهاد بهبود از مدل پرسیده می‌شود. اخبار و فرصت‌ها علاوه بر متن، به‌صورت فایل صوتی mp3 فارسی با صدای زن و حداکثر حدود دو دقیقه (`digest-voice.ts` + پرامپت `telegram_digest_voice` + `speakTts`) با `sendAudio` فرستاده می‌شود؛ صدا از `TTS_VOICE` خوانده می‌شود و فقط مقادیر زنانه پذیرفته است. مدل صوت اخبار روزانه از فیلد `ttsModel` در تنظیمات ربات تلگرام می‌آید و پیش‌فرض آن `gemini-2.5-pro-preview-tts` است.
دستیار تلگرام: ربات دوطرفه جدا (`telegram-assistant`) برای پرسش، ترجمهٔ صفحه، PDF فارسی RTL و صوت یوتیوب.
درس‌آموخته‌ها: `POST /api/lessons/upload` فایل PDF اقتصاد ایران را به مدل می‌دهد؛ درس‌های استخراج‌شده در `Lesson` ذخیره می‌شوند و در پیشنهاد سبد می‌آیند. اخبار کلان جهان هم اگر درس پایدار داشته باشند درس جدید اضافه می‌کنند (تکراری با عنوان یکسان ثبت نمی‌شود).

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
