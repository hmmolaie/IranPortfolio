import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { extractFundReportText, safeUploadFileName } from './extract-report-text';

type FundAnalysis = {
  guessedStrategyFa: string;
  rating: number;
  useInSuggestions: boolean;
  lessons: Array<{ titleFa: string; bodyFa: string }>;
  strengthsFa?: string;
  weaknessesFa?: string;
  allocationSummaryFa?: string;
};

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  listDefinitions(userId: string) {
    return this.prisma.fundDefinition.findMany({
      where: { userId, isActive: true },
      orderBy: { nameFa: 'asc' },
    });
  }

  createDefinition(userId: string, data: { nameFa: string; symbolCode?: string; description?: string }) {
    return this.prisma.fundDefinition.create({
      data: {
        userId,
        nameFa: data.nameFa.trim(),
        symbolCode: data.symbolCode?.trim(),
        description: data.description?.trim(),
      },
    });
  }

  async removeDefinition(userId: string, id: string) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    await this.prisma.fundDefinition.update({
      where: { id },
      data: { isActive: false },
    });
    return { ok: true };
  }

  list(userId: string) {
    return this.prisma.fundReport.findMany({
      where: { userId },
      orderBy: [{ reportYear: 'desc' }, { reportMonthNum: 'desc' }, { createdAt: 'desc' }],
      include: { lessons: true, fundDefinition: true },
    });
  }

  async getTimeline(userId: string, fundDefinitionId: string) {
    const def = await this.prisma.fundDefinition.findFirst({
      where: { id: fundDefinitionId, userId },
    });
    if (!def) throw new NotFoundException('صندوق یافت نشد');

    const reports = await this.prisma.fundReport.findMany({
      where: { userId, fundDefinitionId },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
    });
    const insights = await this.prisma.fundTimelineInsight.findMany({
      where: { userId, fundDefinitionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { fund: def, reports, insights };
  }

  async remove(userId: string, id: string) {
    const report = await this.prisma.fundReport.findFirst({ where: { id, userId } });
    if (!report) throw new NotFoundException('گزارش پیدا نشد');

    await this.prisma.$transaction([
      this.prisma.lesson.deleteMany({ where: { fundReportId: id, userId } }),
      this.prisma.fundReport.delete({ where: { id } }),
    ]);

    if (report.filePath) {
      try {
        await fs.unlink(report.filePath);
      } catch {
        /* ignore */
      }
    }

    if (report.fundDefinitionId) {
      await this.analyzeTimeline(userId, report.fundDefinitionId).catch(() => undefined);
    }

    return { ok: true, id };
  }

  async uploadAndAnalyze(
    userId: string,
    file: Express.Multer.File,
    fundDefinitionId: string,
    reportYear: number,
    reportMonthNum: number,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('فایل گزارش ارسال نشده است');
    }
    if (reportMonthNum < 1 || reportMonthNum > 12) {
      throw new BadRequestException('ماه شمسی باید بین ۱ تا ۱۲ باشد');
    }

    const def = await this.prisma.fundDefinition.findFirst({
      where: { id: fundDefinitionId, userId, isActive: true },
    });
    if (!def) throw new NotFoundException('صندوق را از تنظیمات تعریف کنید');

    const reportMonth = `${reportYear}-${String(reportMonthNum).padStart(2, '0')}`;
    const fundName = def.nameFa;

    const { kind, text: extractedText } = await extractFundReportText(file);
    if (kind === 'unknown' && !extractedText) {
      throw new BadRequestException('فرمت فایل پشتیبانی نمی‌شود. PDF یا Excel (xlsx/xls) بفرستید.');
    }

    const dir = path.join(process.cwd(), 'uploads', 'funds');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeUploadFileName(file.originalname));
    await fs.writeFile(filePath, file.buffer);

    const analysis = await this.runFundAnalysis(
      userId,
      fundName,
      reportMonth,
      kind,
      extractedText,
    );

    const report = await this.prisma.fundReport.create({
      data: {
        userId,
        fundDefinitionId,
        fundName,
        reportMonth,
        reportYear,
        reportMonthNum,
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

    await this.analyzeTimeline(userId, fundDefinitionId).catch(() => undefined);

    return this.prisma.fundReport.findUnique({
      where: { id: report.id },
      include: { lessons: true, fundDefinition: true },
    });
  }

  async analyzeTimeline(userId: string, fundDefinitionId: string) {
    const reports = await this.prisma.fundReport.findMany({
      where: { userId, fundDefinitionId },
      orderBy: [{ reportYear: 'asc' }, { reportMonthNum: 'asc' }],
    });
    if (reports.length < 2) {
      return { ok: false, reason: 'حداقل دو گزارش ماهانه لازم است' };
    }

    const prev = reports[reports.length - 2];
    const curr = reports[reports.length - 1];

    type TimelineOut = {
      summaryFa: string;
      strategyChangeFa: string;
      holdingsDiffFa: string;
      llmReasoningFa: string;
    };

    let out: TimelineOut;
    try {
      out = await this.llm.chatJson<TimelineOut>(
        'fund_timeline_analysis',
        `تحلیل‌گر صندوق‌های ایران هستی. دو گزارش ماهانه پشت‌سرهم را مقایسه کن.
فقط JSON:
{
  "summaryFa": "خلاصه تغییرات",
  "strategyChangeFa": "تغییر استراتژی مدیر",
  "holdingsDiffFa": "تفاوت سبد/خرید و فروش",
  "llmReasoningFa": "چرا مدیر احتمالاً این تصمیم را گرفته"
}`,
        JSON.stringify({
          fundName: curr.fundName,
          from: {
            month: prev.reportMonth,
            strategy: prev.guessedStrategyFa,
            excerpt: (prev.extractedText ?? '').slice(0, 8000),
          },
          to: {
            month: curr.reportMonth,
            strategy: curr.guessedStrategyFa,
            excerpt: (curr.extractedText ?? '').slice(0, 8000),
          },
        }),
        userId,
      );
    } catch (e) {
      out = {
        summaryFa: 'تحلیل مقایسه‌ای بدون LLM',
        strategyChangeFa: `${prev.guessedStrategyFa ?? ''} → ${curr.guessedStrategyFa ?? ''}`,
        holdingsDiffFa: 'مقایسه دستی لازم است',
        llmReasoningFa: (e as Error).message.slice(0, 200),
      };
    }

    const insight = await this.prisma.fundTimelineInsight.create({
      data: {
        userId,
        fundDefinitionId,
        fromReportId: prev.id,
        toReportId: curr.id,
        summaryFa: out.summaryFa,
        strategyChangeFa: out.strategyChangeFa,
        holdingsDiffFa: out.holdingsDiffFa,
        llmReasoningFa: out.llmReasoningFa,
      },
    });

    return { ok: true, insight };
  }

  private async runFundAnalysis(
    userId: string,
    fundName: string,
    reportMonth: string,
    kind: string,
    extractedText: string,
  ): Promise<FundAnalysis> {
    try {
      const analysis = await this.llm.chatJson<FundAnalysis>(
        'fund_report_analysis',
        `تو تحلیل‌گر صندوق‌های سرمایه‌گذاری ایران هستی.
ورودی می‌تواند متن PDF یا جدول استخراج‌شده از Excel صورت‌وضعیت پرتفوی باشد.
فقط JSON معتبر برگردان:
{
  "guessedStrategyFa": "...",
  "allocationSummaryFa": "خلاصه تخصیص",
  "rating": 7.5,
  "useInSuggestions": true,
  "strengthsFa": "...",
  "weaknessesFa": "...",
  "lessons": [{"titleFa":"...","bodyFa":"..."}]
}`,
        `نام صندوق: ${fundName}
ماه گزارش: ${reportMonth}
نوع فایل: ${kind}
متن:
${extractedText || 'متن استخراج نشد'}`,
        userId,
      );
      if (!analysis.guessedStrategyFa) throw new Error('فیلد guessedStrategyFa نبود');
      analysis.lessons = Array.isArray(analysis.lessons) ? analysis.lessons : [];
      analysis.rating = Number(analysis.rating) || 5;
      if (analysis.allocationSummaryFa) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\nتخصیص: ${analysis.allocationSummaryFa}`;
      }
      return analysis;
    } catch (e) {
      const detail = (e as Error).message?.slice(0, 240) || 'خطای نامشخص';
      return {
        guessedStrategyFa: `تحلیل LLM در دسترس نبود؛ بررسی دستی لازم است. (${detail})`,
        rating: 5,
        useInSuggestions: false,
        lessons: [],
      };
    }
  }
}
