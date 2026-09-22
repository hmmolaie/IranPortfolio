import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CONFIG_ID = 'default';

export type ContentRefreshSchedule = {
  iranNewsHour: number;
  iranNewsMinute: number;
  worldHour: number;
  worldMinute: number;
  marketHour: number;
  marketMinute: number;
};

const DEFAULTS: ContentRefreshSchedule = {
  iranNewsHour: 8,
  iranNewsMinute: 0,
  worldHour: 7,
  worldMinute: 0,
  marketHour: 22,
  marketMinute: 0,
};

function clock(hour: number | null | undefined, minute: number | null | undefined, fallbackH: number, fallbackM: number) {
  return {
    hour: hour ?? fallbackH,
    minute: minute ?? fallbackM,
  };
}

export async function readRefreshSchedule(prisma: PrismaService): Promise<ContentRefreshSchedule> {
  const row = await prisma.contentRefreshSchedule.findUnique({ where: { id: CONFIG_ID } });
  const iran = clock(row?.iranNewsHour, row?.iranNewsMinute, DEFAULTS.iranNewsHour, DEFAULTS.iranNewsMinute);
  const world = clock(row?.worldHour, row?.worldMinute, DEFAULTS.worldHour, DEFAULTS.worldMinute);
  const market = clock(row?.marketHour, row?.marketMinute, DEFAULTS.marketHour, DEFAULTS.marketMinute);
  return {
    iranNewsHour: iran.hour,
    iranNewsMinute: iran.minute,
    worldHour: world.hour,
    worldMinute: world.minute,
    marketHour: market.hour,
    marketMinute: market.minute,
  };
}

function assertClock(hour: number, minute: number, labelFa: string) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new BadRequestException(`ساعت ${labelFa} نامعتبر است`);
  }
}

export async function saveRefreshSchedule(
  prisma: PrismaService,
  data: ContentRefreshSchedule,
): Promise<ContentRefreshSchedule> {
  assertClock(data.iranNewsHour, data.iranNewsMinute, 'اخبار ایران');
  assertClock(data.worldHour, data.worldMinute, 'اقتصاد دنیا');
  assertClock(data.marketHour, data.marketMinute, 'بازار سهام');
  await prisma.contentRefreshSchedule.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...data },
    update: data,
  });
  return data;
}

/** همان دقیقه، یا ۶۰ و ۱۲۰ دقیقه بعد اگر از نیمه‌شب نگذرد */
export function isRefreshSlot(nowMin: number, atMin: number, withRetry: boolean): 'exact' | 'retry' | null {
  if (nowMin === atMin) return 'exact';
  if (!withRetry) return null;
  if (atMin + 60 < 24 * 60 && nowMin === atMin + 60) return 'retry';
  if (atMin + 120 < 24 * 60 && nowMin === atMin + 120) return 'retry';
  return null;
}
