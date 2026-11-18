-- یک‌بار اجرا: حذف تحلیل‌های ماه‌به‌ماه تکراری صندوق‌ها (FundTimelineInsight)
--
-- بعد از استقرار نسخه‌ای اجرا شود که ستون‌های toReportYear و toReportMonthNum را دارد
-- (prisma db push هنگام بالا آمدن کانتینر api آن‌ها را می‌سازد). روی سرور:
--
--   docker compose exec -T db psql -U sabadyar -d sabadyar -v ON_ERROR_STOP=1 < scripts/once/dedupe-fund-timeline-insights.sql
--
-- کار اسکریپت:
--   ۱. تحلیل‌های جایگزین بدون مدل («تحلیل مقایسه‌ای بدون LLM») را حذف می‌کند؛ تحلیل AI نیستند
--      و نباید ماه را برای تحلیل واقعی قفل کنند.
--   ۲. برای هر صندوق و هر ماه گزارش مقصد فقط تازه‌ترین تحلیل را نگه می‌دارد.
--   ۳. ماه گزارش مقصد را روی تحلیل‌های قدیمی می‌نویسد تا ایندکس یکتا جلوی تکرار بعدی را بگیرد.
-- اجرای دوباره چیزی را عوض نمی‌کند.

BEGIN;

SELECT count(*) AS "before" FROM "FundTimelineInsight";

DELETE FROM "FundTimelineInsight"
WHERE "summaryFa" = 'تحلیل مقایسه‌ای بدون LLM';

WITH resolved AS (
  SELECT
    i.id,
    i."fundDefinitionId",
    i."createdAt",
    COALESCE(i."toReportYear", r."reportYear") AS y,
    COALESCE(i."toReportMonthNum", r."reportMonthNum") AS m,
    i."toReportId"
  FROM "FundTimelineInsight" i
  LEFT JOIN "FundReport" r ON r.id = i."toReportId"
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        "fundDefinitionId",
        CASE
          WHEN y IS NOT NULL AND m IS NOT NULL THEN y::text || '-' || m::text
          ELSE 'report:' || COALESCE("toReportId", id)
        END
      ORDER BY "createdAt" DESC, id DESC
    ) AS rn
  FROM resolved
)
DELETE FROM "FundTimelineInsight"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

UPDATE "FundTimelineInsight" i
SET "toReportYear" = r."reportYear",
    "toReportMonthNum" = r."reportMonthNum"
FROM "FundReport" r
WHERE r.id = i."toReportId"
  AND i."toReportYear" IS NULL
  AND r."reportYear" IS NOT NULL
  AND r."reportMonthNum" IS NOT NULL;

SELECT count(*) AS "after" FROM "FundTimelineInsight";

COMMIT;
