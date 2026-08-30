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
  managerTechnicalScore?: number;
  managerTechnicalReasonFa?: string;
  riskAppetiteScore?: number;
  riskAppetiteReasonFa?: string;
  professionalismScore?: number;
  professionalismReasonFa?: string;
  useInSuggestions: boolean;
  lessons: Array<{ titleFa: string; bodyFa: string }>;
  strengthsFa?: string;
  weaknessesFa?: string;
  allocationSummaryFa?: string;
};

function clampScore(n: unknown): number | null {
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  return Math.min(10, Math.max(1, Math.round(v * 10) / 10));
}

@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  listDefinitions(userId: string, includeInactive = false) {
    return this.prisma.fundDefinition.findMany({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { nameFa: 'asc' }],
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

  async updateDefinition(
    userId: string,
    id: string,
    data: { nameFa?: string; symbolCode?: string; description?: string },
  ) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    return this.prisma.fundDefinition.update({
      where: { id },
      data: {
        ...(data.nameFa !== undefined ? { nameFa: data.nameFa.trim() } : {}),
        ...(data.symbolCode !== undefined ? { symbolCode: data.symbolCode.trim() || null } : {}),
        ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
      },
    });
  }

  async setDefinitionActive(userId: string, id: string, isActive: boolean) {
    const def = await this.prisma.fundDefinition.findFirst({ where: { id, userId } });
    if (!def) throw new NotFoundException('صندوق تعریف‌شده یافت نشد');
    return this.prisma.fundDefinition.update({
      where: { id },
      data: { isActive },
    });
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

    const { kind, text: extractedText, excel } = await extractFundReportText(file);
    if (kind === 'unknown' && !extractedText) {
      throw new BadRequestException('فرمت فایل پشتیبانی نمی‌شود. PDF یا Excel (xlsx/xls) بفرستید.');
    }

    const sheetsPayload = excel
      ? {
          sheetCount: excel.sheetCount,
          sheetNames: excel.sheetNames,
          sheets: excel.sheets.map((s) => ({
            name: s.name,
            category: s.category,
            priority: s.priority,
            rowCount: s.rowCount,
            sectionTitles: s.sectionTitles,
            headers: s.headers,
            rows: s.rows,
          })),
        }
      : null;

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
      excel,
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
        extractedSheetsJson: sheetsPayload ?? undefined,
        guessedStrategyFa: analysis.guessedStrategyFa,
        rating: analysis.rating,
        managerTechnicalScore: analysis.managerTechnicalScore,
        riskAppetiteScore: analysis.riskAppetiteScore,
        professionalismScore: analysis.professionalismScore,
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
      const system = await this.llm.getSystemPrompt(userId, 'fund_timeline_analysis');
      out = await this.llm.chatJson<TimelineOut>(
        'fund_timeline_analysis',
        system,
        JSON.stringify({
          fundName: curr.fundName,
          from: {
            month: prev.reportMonth,
            strategy: prev.guessedStrategyFa,
            sheets: this.sheetNamesFromJson(prev.extractedSheetsJson),
            excerpt: (prev.extractedText ?? '').slice(0, 8000),
          },
          to: {
            month: curr.reportMonth,
            strategy: curr.guessedStrategyFa,
            sheets: this.sheetNamesFromJson(curr.extractedSheetsJson),
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

  private sheetNamesFromJson(json: unknown): string[] {
    if (!json || typeof json !== 'object') return [];
    const o = json as { sheetNames?: string[]; sheets?: Array<{ name: string }> };
    if (Array.isArray(o.sheetNames) && o.sheetNames.length) return o.sheetNames;
    if (Array.isArray(o.sheets)) return o.sheets.map((s) => s.name).filter(Boolean);
    return [];
  }

  private async runFundAnalysis(
    userId: string,
    fundName: string,
    reportMonth: string,
    kind: string,
    extractedText: string,
    excel?: import('./extract-report-text').ExcelExtractionResult,
  ): Promise<FundAnalysis> {
    const sheetOverview = excel?.sheets.map((s) => ({
      name: s.name,
      category: s.category,
      rowCount: s.rowCount,
      dataRows: s.rows.length,
      sectionTitles: s.sectionTitles.slice(0, 5),
    }));

    try {
      const system = await this.llm.getSystemPrompt(userId, 'fund_report_analysis');
      const analysis = await this.llm.chatJson<FundAnalysis>(
        'fund_report_analysis',
        system,
        `نام صندوق: ${fundName}
ماه گزارش: ${reportMonth}
نوع فایل: ${kind}
${excel ? `تعداد شیت اکسل: ${excel.sheetCount}\nشیت‌ها: ${excel.sheetNames.join('، ')}` : ''}
${sheetOverview ? `خلاصه شیت‌ها:\n${JSON.stringify(sheetOverview, null, 2)}` : ''}

متن استخراج‌شده (همهٔ شیت‌ها):
${extractedText || 'متن استخراج نشد'}`,
        userId,
      );
      if (!analysis.guessedStrategyFa) throw new Error('فیلد guessedStrategyFa نبود');
      analysis.lessons = Array.isArray(analysis.lessons) ? analysis.lessons : [];
      analysis.rating = clampScore(analysis.rating) ?? 5;
      analysis.managerTechnicalScore = clampScore(analysis.managerTechnicalScore) ?? undefined;
      analysis.riskAppetiteScore = clampScore(analysis.riskAppetiteScore) ?? undefined;
      analysis.professionalismScore = clampScore(analysis.professionalismScore) ?? undefined;

      const scoreParts: string[] = [];
      if (analysis.managerTechnicalScore != null) {
        scoreParts.push(
          `نمره فنی مدیر: ${analysis.managerTechnicalScore}/10` +
            (analysis.managerTechnicalReasonFa ? ` — ${analysis.managerTechnicalReasonFa}` : ''),
        );
      }
      if (analysis.riskAppetiteScore != null) {
        scoreParts.push(
          `ریسک‌پذیری: ${analysis.riskAppetiteScore}/10` +
            (analysis.riskAppetiteReasonFa ? ` — ${analysis.riskAppetiteReasonFa}` : ''),
        );
      }
      if (analysis.professionalismScore != null) {
        scoreParts.push(
          `حرفه‌ای‌بودن مالی: ${analysis.professionalismScore}/10` +
            (analysis.professionalismReasonFa ? ` — ${analysis.professionalismReasonFa}` : ''),
        );
      }
      if (analysis.allocationSummaryFa) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\nتخصیص: ${analysis.allocationSummaryFa}`;
      }
      if (scoreParts.length) {
        analysis.guessedStrategyFa = `${analysis.guessedStrategyFa}\n\n${scoreParts.join('\n')}`;
      }
      return analysis;
    } catch (e) {
      const detail = (e as Error).message?.slice(0, 240) || 'خطای نامشخص';
      return {
        guessedStrategyFa: `تحلیل LLM در دسترس نبود؛ بررسی دستی لازم است. (${detail})`,
        rating: 5,
        useInSuggestions: false,
        lessons: [],
        managerTechnicalScore: undefined,
        riskAppetiteScore: undefined,
        professionalismScore: undefined,
      };
    }
  }
}
