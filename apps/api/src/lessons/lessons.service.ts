import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { safeUploadFileName } from '../funds/extract-report-text';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const MAX_FILE_BYTES = 35 * 1024 * 1024;
const MIN_TEXT_CHARS = 80;
const CHUNK_CHARS = 48_000;
const CHUNK_OVERLAP = 600;
const MAX_CHUNKS = 4;
const MAX_EXTRACT_CHARS = CHUNK_CHARS * MAX_CHUNKS + CHUNK_OVERLAP;
const MAX_LESSONS_PER_CHUNK = 12;
const MAX_TOTAL_LESSONS = 40;
const SOURCE_PREFIX = 'iran_economy_pdf';

type ExtractedLesson = { titleFa: string; bodyFa: string };

type LlmLessonOut = {
  documentTitleFa?: string;
  lessons?: Array<{ titleFa?: string; bodyFa?: string; portfolioImplicationFa?: string }>;
};

@Injectable()
export class LessonsService {
  private readonly logger = new Logger(LessonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  list(userId: string) {
    return this.prisma.lesson.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createManual(userId: string, data: { titleFa: string; bodyFa: string }) {
    const titleFa = data.titleFa.replace(/\s+/g, ' ').trim().slice(0, 180);
    const bodyFa = data.bodyFa.trim().slice(0, 4000);
    if (titleFa.length < 2) throw new BadRequestException('عنوان درس را بنویسید');
    if (bodyFa.length < 4) throw new BadRequestException('متن درس را بنویسید');
    const dup = await this.dropDuplicates(userId, [{ titleFa, bodyFa }]);
    if (!dup.length) {
      throw new BadRequestException('درسی با همین عنوان قبلاً ثبت شده است');
    }
    return this.prisma.lesson.create({
      data: { userId, titleFa, bodyFa, source: 'manual' },
    });
  }

  async remove(userId: string, id: string) {
    const row = await this.prisma.lesson.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('درس‌آموخته پیدا نشد');
    await this.prisma.lesson.delete({ where: { id } });
    return { ok: true };
  }

  async ingestIranEconomyPdf(userId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('فایل PDF ارسال نشده است');
    }
    if (file.buffer.length > MAX_FILE_BYTES) {
      throw new BadRequestException('حجم فایل نباید بیشتر از ۳۵ مگابایت باشد');
    }
    if (!isPdfFile(file)) {
      throw new BadRequestException('فقط فایل PDF اقتصاد ایران پذیرفته می‌شود');
    }

    let extractedText = '';
    try {
      const parsed = await pdfParse(file.buffer);
      extractedText = (parsed.text || '').replace(/\u0000/g, '').trim().slice(0, MAX_EXTRACT_CHARS);
    } catch (e) {
      this.logger.warn(`استخراج PDF ناموفق: ${(e as Error).message}`);
      throw new BadRequestException('خواندن متن PDF ناموفق بود. فایل متنی (نه فقط تصویر) بفرستید.');
    }
    if (extractedText.length < MIN_TEXT_CHARS) {
      throw new BadRequestException(
        'متن قابل استفاده‌ای از PDF استخراج نشد. فایل باید متنی باشد، نه اسکن تصویر.',
      );
    }

    const dir = path.join(process.cwd(), 'uploads', 'lessons');
    await fs.mkdir(dir, { recursive: true });
    const storedName = safeUploadFileName(file.originalname || 'iran-economy.pdf');
    await fs.writeFile(path.join(dir, storedName), file.buffer);

    const chunks = chunkText(extractedText, CHUNK_CHARS, CHUNK_OVERLAP, MAX_CHUNKS);
    const originalName = path.basename(file.originalname || storedName);
    const source = `${SOURCE_PREFIX}:${originalName}`;
    const system = await this.llm.getSystemPrompt(userId, 'iran_economy_pdf_lessons');

    const collected: ExtractedLesson[] = [];
    let lastError: string | undefined;
    for (let i = 0; i < chunks.length; i += 1) {
      try {
        const out = await this.llm.chatJson<LlmLessonOut>(
          'iran_economy_pdf_lessons',
          system,
          `نام فایل: ${originalName}
بخش ${i + 1} از ${chunks.length}

متن PDF:
${chunks[i]}`,
          userId,
        );
        collected.push(...normalizeLessons(out));
      } catch (e) {
        lastError = (e as Error).message?.slice(0, 240) || 'خطای نامشخص';
        this.logger.warn(`استخراج درس از بخش ${i + 1} ناموفق: ${lastError}`);
      }
    }

    if (!collected.length) {
      throw new BadRequestException(
        lastError
          ? `مدل نتوانست درس‌آموخته استخراج کند. (${lastError})`
          : 'مدل درس‌آموخته‌ای از این فایل برنگرداند.',
      );
    }

    const unique = await this.dropDuplicates(userId, collected);
    if (!unique.length) {
      throw new BadRequestException('درس‌آموخته‌های این فایل قبلاً در پایگاه ثبت شده است.');
    }

    const created = [];
    for (const lesson of unique.slice(0, MAX_TOTAL_LESSONS)) {
      created.push(
        await this.prisma.lesson.create({
          data: {
            userId,
            titleFa: lesson.titleFa,
            bodyFa: lesson.bodyFa,
            source,
          },
        }),
      );
    }

    return {
      fileName: originalName,
      extractedChars: extractedText.length,
      chunkCount: chunks.length,
      createdCount: created.length,
      lessons: created,
    };
  }

  private async dropDuplicates(userId: string, incoming: ExtractedLesson[]): Promise<ExtractedLesson[]> {
    const existing = await this.prisma.lesson.findMany({
      where: { userId },
      select: { titleFa: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });
    const seen = new Set(existing.map((l) => normTitle(l.titleFa)));
    const out: ExtractedLesson[] = [];
    for (const lesson of incoming) {
      const key = normTitle(lesson.titleFa);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(lesson);
    }
    return out;
  }
}

function isPdfFile(file: Express.Multer.File): boolean {
  const name = (file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (name.endsWith('.pdf') || mime.includes('pdf')) return true;
  return file.buffer.subarray(0, 4).toString('utf8') === '%PDF';
}

function chunkText(text: string, size: number, overlap: number, maxChunks: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return chunks;
}

function normTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeLessons(out: LlmLessonOut | null | undefined): ExtractedLesson[] {
  const raw = Array.isArray(out?.lessons) ? out.lessons : [];
  const lessons: ExtractedLesson[] = [];
  for (const item of raw.slice(0, MAX_LESSONS_PER_CHUNK)) {
    const titleFa = String(item?.titleFa ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    let bodyFa = String(item?.bodyFa ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    const implication = String(item?.portfolioImplicationFa ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
    if (implication && !bodyFa.includes(implication)) {
      bodyFa = bodyFa ? `${bodyFa}\n\nاثر روی سبد: ${implication}` : implication;
    }
    if (titleFa.length < 4 || bodyFa.length < 20) continue;
    lessons.push({ titleFa, bodyFa });
  }
  return lessons;
}
