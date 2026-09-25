import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeIranMobile } from '../common/iran-mobile';

const LOCATION_RE = /^-?\d{1,2}(\.\d{1,6})?,-?\d{1,3}(\.\d{1,6})?$/;

@Injectable()
export class MobileLoginService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.mobileLoginConfig.findUnique({ where: { id: 'default' } });
    return Boolean(row?.enabled);
  }

  async setEnabled(enabled: boolean) {
    const row = await this.prisma.mobileLoginConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', enabled },
      update: { enabled },
    });
    return { enabled: row.enabled };
  }

  async listForAdmin() {
    const [enabled, rows] = await Promise.all([
      this.isEnabled(),
      this.prisma.mobileLogin.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    return {
      enabled,
      rows: rows.map((row) => ({
        id: row.id,
        ip: row.ip,
        location: row.location,
        mobilePhone: row.mobilePhone,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    };
  }

  async openVisit(ip: string | null) {
    await this.assertEnabled();
    const row = await this.prisma.mobileLogin.create({
      data: { ip },
    });
    return { id: row.id };
  }

  async saveLocation(id: string, location: string) {
    await this.assertEnabled();
    const normalized = normalizeLocation(location);
    if (!normalized) throw new BadRequestException('موقعیت نامعتبر است.');
    await this.requireRow(id);
    await this.prisma.mobileLogin.update({
      where: { id },
      data: { location: normalized },
    });
    return { ok: true };
  }

  async saveMobile(id: string, mobilePhone: string) {
    await this.assertEnabled();
    const mobile = normalizeIranMobile(mobilePhone);
    if (!mobile) throw new BadRequestException('شماره موبایل معتبر نیست.');
    await this.requireRow(id);
    await this.prisma.mobileLogin.update({
      where: { id },
      data: { mobilePhone: mobile },
    });
    return { ok: true, mobilePhone: mobile };
  }

  private async assertEnabled() {
    if (!(await this.isEnabled())) {
      throw new ForbiddenException('ورود با موبایل خاموش است.');
    }
  }

  private async requireRow(id: string) {
    const row = await this.prisma.mobileLogin.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('رکورد ورود پیدا نشد.');
    return row;
  }
}

function normalizeLocation(raw: string): string | null {
  const text = raw.replace(/\s+/g, '');
  if (!LOCATION_RE.test(text)) return null;
  const [latRaw, lngRaw] = text.split(',');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function clientIpFromHeaders(headers: Record<string, string | string[] | undefined>, fallback?: string): string | null {
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = (raw ?? fallback ?? '').split(',')[0]?.trim() ?? '';
  const ip = first.replace(/^::ffff:/, '').slice(0, 64);
  return ip || null;
}
