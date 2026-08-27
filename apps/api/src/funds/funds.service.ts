import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractFundReportText, safeUploadFileName } from './extract-report-text';

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  list(userId: string) {
    return this.prisma.fundReport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { lessons: true },
    });
  }

  async remove(userId: string, id: string) {
    const report = await this.prisma.fundReport.findFirst({ where: { id, userId } });
    if (!report) {
      throw new NotFoundException('گزارش پیدا نشد');
    }

    await this.prisma.$transaction([
      this.prisma.lesson.deleteMany({ where: { fundReportId: id, userId } }),
      this.prisma.fundReport.delete({ where: { id } }),
    ]);

    if (report.filePath) {
      try {
        await fs.unlink(report.filePath);
      } catch {
        // فایل ممکن است قبلاً حذف شده باشد
      }
    }

    return { ok: true, id };
  }

  async uploadAndAnalyze(
    userId: string,
    file: Express.Multer.File,
    fundName: string,
    reportMonth: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('فایل گزارش ارسال نشده است');
    }

    const { kind, text: extractedText } = await extractFundReportText(file);
    if (kind === 'unknown' && !extractedText) {
      throw new BadRequestException('فرمت فایل پشتیبانی نمی‌شود. PDF یا Excel (xlsx/xls) بفرستید.');
    }

    const dir = path.join(process.cwd(), 'uploads', 'funds');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeUploadFileName(file.originalname));
    await fs.writeFile(filePath, file.buffer);

    type Analysis = {
      guessedStrategyFa: string;
      rating: number;
      useInSuggestions: boolean;
      lessons: Array<{ titleFa: string; bodyFa: string }>;
      strengthsFa?: string;
      weaknessesFa?: string;
      allocationSummaryFa?: string;
    };

    let analysis: Analysis;
    try {
      analysis = await this.llm.chatJson<Analysis>(
        'fund_report_analysis',
        `تو تحلیل‌گر صندوق‌های سرمایه‌گذاری ایران هستی.
ورودی می‌تواند متن PDF یا جدول استخراج‌شده از Excel صورت‌وضعیت پرتفوی باشد (شیت‌های سهام، کالا/شمش، اوراق، سپرده و درآمدها).
از ترکیب دارایی‌ها، درصدها، خرید/فروش طی دوره و درآمدها، استراتژی مدیر را حدس بزن و امتیاز ۱ تا ۱۰ بده.
فقط یک شیء JSON معتبر برگردان، بدون توضیح اضافه.
JSON:
{
  "guessedStrategyFa": "...",
  "allocationSummaryFa": "خلاصه تخصیص (سهام/اوراق/طلا/سپرده/...)",
  "rating": 7.5,
  "useInSuggestions": true,
  "strengthsFa": "...",
  "weaknessesFa": "...",
  "lessons": [{"titleFa":"...","bodyFa":"..."}]
}`,
        `نام صندوق: ${fundName}
ماه گزارش: ${reportMonth}
نوع فایل: ${kind}
متن/جداول استخراج‌شده:
${extractedText || 'متن استخراج نشد — فقط بر اساس نام صندوق و ماه حدس محتاطانه بزن و امتیاز را پایین نگه دار.'}`,
        userId,
      );
      if (!analysis.guessedStrategyFa) {
        throw new Error('فیلد guessedStrategyFa در پاسخ مدل نبود');
      }
      analysis.lessons = Array.isArray(analysis.lessons) ? analysis.lessons : [];
      analysis.rating = Number(analysis.rating) || 5;
      if (analysis.allocationSummaryFa) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\nتخصیص: ${analysis.allocationSummaryFa}`;
      }
    } catch (e) {
      const detail = (e as Error).message?.slice(0, 240) || 'خطای نامشخص';
      analysis = {
        guessedStrategyFa: `تحلیل LLM در دسترس نبود؛ بررسی دستی لازم است. (${detail})`,
        rating: 5,
        useInSuggestions: false,
        lessons: [],
      };
    }

    const report = await this.prisma.fundReport.create({
      data: {
        userId,
        fundName,
        reportMonth,
        filePath,
        extractedText,
        guessedStrategyFa: analysis.guessedStrategyFa,
        rating: analysis.rating,
        useInSuggestions: Boolean(analysis.useInSuggestions && (analysis.rating ?? 0) >= 7),
        analysisJson: analysis as object,
      },
    });

    for (const lesson of analysis.lessons ?? []) {
      await this.prisma.lesson.create({
        data: {
          userId,
          fundReportId: report.id,
          titleFa: lesson.titleFa,
          bodyFa: lesson.bodyFa,
          source: 'fund_report',
        },
      });
    }

    return this.prisma.fundReport.findUnique({
      where: { id: report.id },
      include: { lessons: true },
    });
  }
}
