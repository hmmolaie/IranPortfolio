import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 7 با درایور pg وصل می‌شود و پارامترهای خود Prisma در DATABASE_URL را نمی‌شناسد؛
 * همان‌ها را به تنظیم معادل pg برمی‌گردانیم تا سقف اتصال و مهلت انتظار مثل قبل بماند.
 */
function databaseAdapter(): PrismaPg {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error('DATABASE_URL تنظیم نشده است');
  const url = new URL(raw);
  const schema = url.searchParams.get('schema') || undefined;
  const limit = Number(url.searchParams.get('connection_limit'));
  const timeoutSec = Number(url.searchParams.get('pool_timeout'));
  for (const key of ['schema', 'connection_limit', 'pool_timeout']) url.searchParams.delete(key);
  return new PrismaPg(
    {
      connectionString: url.toString(),
      ...(limit > 0 ? { max: limit } : {}),
      ...(timeoutSec > 0 ? { connectionTimeoutMillis: timeoutSec * 1000 } : {}),
    },
    schema ? { schema } : undefined,
  );
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: databaseAdapter() });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
