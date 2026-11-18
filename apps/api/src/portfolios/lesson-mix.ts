import { PrismaService } from '../prisma/prisma.service';

/** منبع درس‌آموخته برای سهمیه‌بندی */
type LessonBucket = 'economy' | 'fund' | 'world' | 'eval';

function bucketOf(source: string | null): LessonBucket {
  if (source === 'fund_report') return 'fund';
  if (source?.startsWith('world_macro_news')) return 'world';
  if (source === 'monthly_eval') return 'eval';
  // فایل PDF اقتصاد ایران، درس دستی ادمین و منابع قدیمی بی‌نام
  return 'economy';
}

/** سهم هر منبع از کل درس‌ها؛ باقی‌ماندهٔ منبعی که درس کافی ندارد به تازه‌ترین‌های بقیه می‌رسد */
const SHARE: Record<LessonBucket, number> = { economy: 0.4, fund: 0.3, world: 0.2, eval: 0.1 };

/**
 * درس‌آموخته‌های متوازن برای پیشنهاد و آنالیز سبد.
 * فقط «تازه‌ترین» نبودن مهم است: درس‌های گزارش صندوق زیاد و تازه‌اند و بدون سهمیه درس‌های اقتصاد ایران را بیرون می‌کنند.
 */
export async function balancedLessons(
  prisma: PrismaService,
  ownerId: string,
  total = 10,
): Promise<Array<{ titleFa: string; bodyFa: string; source: string | null }>> {
  const rows = await prisma.lesson.findMany({
    where: { userId: ownerId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, titleFa: true, bodyFa: true, source: true },
  });
  const buckets: Record<LessonBucket, typeof rows> = { economy: [], fund: [], world: [], eval: [] };
  for (const row of rows) buckets[bucketOf(row.source)].push(row);

  const picked: typeof rows = [];
  const used = new Set<string>();
  for (const bucket of Object.keys(SHARE) as LessonBucket[]) {
    const quota = Math.round(total * SHARE[bucket]);
    for (const row of buckets[bucket].slice(0, quota)) {
      picked.push(row);
      used.add(row.id);
    }
  }
  for (const row of rows) {
    if (picked.length >= total) break;
    if (used.has(row.id)) continue;
    picked.push(row);
    used.add(row.id);
  }
  return picked.slice(0, total).map(({ titleFa, bodyFa, source }) => ({ titleFa, bodyFa, source }));
}
