import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { mkdir, open, readdir, rm, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { tehranDateKey } from '../news/tehran-date';

const DUMP_NAME = /^piiip-\d{4}-\d{2}-\d{2}-\d{6}\.dump$/;
const MAX_KEEP = 15;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

type PgTarget = { env: NodeJS.ProcessEnv; database: string };

@Injectable()
export class BackupService {
  private busy = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  dir(): string {
    return this.config.get<string>('BACKUP_DIR')?.trim() || join(process.cwd(), 'backups');
  }

  async list() {
    const dir = this.dir();
    await mkdir(dir, { recursive: true });
    const names = (await readdir(dir)).filter((name) => DUMP_NAME.test(name));
    const rows = await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(dir, name));
        return { name, bytes: info.size, createdAt: info.mtime.toISOString() };
      }),
    );
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { items: rows };
  }

  async create() {
    return this.exclusive(async () => {
      const dir = this.dir();
      await mkdir(dir, { recursive: true });
      const name = `piiip-${this.stamp()}.dump`;
      const file = join(dir, name);
      const { env } = this.pg();
      const result = await this.run('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-f', file], env);
      if (result.code !== 0) {
        await unlink(file).catch(() => undefined);
        throw new BadRequestException(this.toolError('ساخت نسخه پشتیبان', result));
      }
      await this.prune(dir);
      const info = await stat(file);
      return { name, bytes: info.size, createdAt: info.mtime.toISOString() };
    });
  }

  async open(name: string) {
    const file = this.safePath(name);
    try {
      const info = await stat(file);
      return {
        filename: name,
        size: info.size,
        stream: createReadStream(file),
      };
    } catch {
      throw new NotFoundException('این نسخه پشتیبان پیدا نشد');
    }
  }

  async restore(file: Express.Multer.File | undefined, confirm: string) {
    if (confirm !== 'بازیابی') {
      if (file?.path) await unlink(file.path).catch(() => undefined);
      throw new BadRequestException('برای بازیابی، عبارت تأیید را دقیقاً وارد کنید.');
    }
    if (!file?.path) throw new BadRequestException('فایل نسخه پشتیبان انتخاب نشده است');
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      await unlink(file.path).catch(() => undefined);
      throw new BadRequestException('حجم فایل پشتیبان قابل قبول نیست');
    }
    return this.exclusive(async () => {
      try {
        await this.assertDump(file.path);
        await this.prisma.$disconnect();
        const { env, database } = this.pg();
        await this.run(
          'psql',
          [
            '-d',
            database,
            '-v',
            'ON_ERROR_STOP=1',
            '-c',
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()',
          ],
          env,
        );
        const result = await this.run(
          'pg_restore',
          ['--clean', '--if-exists', '--no-owner', '--no-acl', '-d', database, file.path],
          env,
        );
        const fatal = /FATAL|could not connect|password authentication failed/i.test(result.stderr);
        if (result.code !== 0 && (result.code !== 1 || fatal)) {
          throw new BadRequestException(this.toolError('بازیابی', result));
        }
        return {
          ok: true,
          messageFa:
            result.code === 0
              ? 'بازیابی انجام شد. صفحه را یک‌بار تازه کنید.'
              : `بازیابی انجام شد، با هشدار ابزار بازیابی. صفحه را یک‌بار تازه کنید. ${result.stderr.slice(0, 240)}`,
        };
      } finally {
        await unlink(file.path).catch(() => undefined);
        await this.prisma.$connect().catch(() => undefined);
      }
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new ConflictException('یک عملیات پشتیبان دیگر هنوز تمام نشده است');
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }

  private safePath(name: string): string {
    if (!DUMP_NAME.test(name)) throw new BadRequestException('نام فایل پشتیبان نامعتبر است');
    return join(this.dir(), name);
  }

  private pg(): PgTarget {
    const raw = this.config.get<string>('DATABASE_URL')?.trim();
    if (!raw) throw new BadRequestException('نشانی پایگاه داده تنظیم نشده است');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('نشانی پایگاه داده نامعتبر است');
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, '').split('?')[0] || '');
    if (!database) throw new BadRequestException('نام پایگاه داده در نشانی نیست');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
    };
    return { env, database };
  }

  private async assertDump(file: string) {
    const handle = await open(file, 'r');
    try {
      const buf = Buffer.alloc(5);
      const { bytesRead } = await handle.read(buf, 0, 5, 0);
      if (bytesRead < 5 || buf.toString('utf8') !== 'PGDMP') {
        throw new BadRequestException('این فایل خروجی pg_dump نیست');
      }
    } finally {
      await handle.close();
    }
  }

  private async prune(dir: string) {
    const names = (await readdir(dir)).filter((name) => DUMP_NAME.test(name));
    const rows = await Promise.all(
      names.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
    );
    rows.sort((a, b) => b.mtime - a.mtime);
    for (const row of rows.slice(MAX_KEEP)) {
      await rm(join(dir, row.name), { force: true });
    }
  }

  private stamp(): string {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
    return `${tehranDateKey(now)}-${pick('hour')}${pick('minute')}${pick('second')}`;
  }

  private toolError(action: string, result: { code: number; stderr: string }): string {
    if (/ENOENT|not found/i.test(result.stderr)) {
      return 'ابزار پشتیبان پایگاه روی این سرور نصب نیست';
    }
    const detail = result.stderr.replace(/\s+/g, ' ').trim().slice(0, 280);
    return detail ? `${action} ناموفق بود. ${detail}` : `${action} ناموفق بود`;
  }

  private run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { env });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 8000) stderr = stderr.slice(-8000);
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          resolve({ code: 127, stderr: 'ENOENT' });
          return;
        }
        reject(error);
      });
      child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    });
  }
}
