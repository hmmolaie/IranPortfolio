import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import * as fs from 'fs/promises';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

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

  async uploadAndAnalyze(
    userId: string,
    file: Express.Multer.File,
    fundName: string,
    reportMonth: string,
  ) {
    const dir = path.join(process.cwd(), 'uploads', 'funds');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}-${file.originalname}`);
    await fs.writeFile(filePath, file.buffer);

    let extractedText = '';
    try {
      const parsed = await pdfParse(file.buffer);
      extractedText = (parsed.text || '').slice(0, 40000);
    } catch {
      extractedText = '';
    }

    type Analysis = {
      guessedStrategyFa: string;
      rating: number;
      useInSuggestions: boolean;
      lessons: Array<{ titleFa: string; bodyFa: string }>;
      strengthsFa?: string;
      weaknessesFa?: string;
    };

    let analysis: Analysis;
    try {
      analysis = await this.llm.chatJson<Analysis>(
        'fund_pdf_analysis',
        `تو تحلیل‌گر صندوق‌های سرمایه‌گذاری ایران هستی. از متن گزارش ماهانه، استراتژی مدیر را حدس بزن و امتیاز ۱ تا ۱۰ بده.
JSON:
{
  "guessedStrategyFa": "...",
  "rating": 7.5,
  "useInSuggestions": true,
  "strengthsFa": "...",
  "weaknessesFa": "...",
  "lessons": [{"titleFa":"...","bodyFa":"..."}]
}`,
        `نام صندوق: ${fundName}\nماه گزارش: ${reportMonth}\nمتن:\n${extractedText || 'متن استخراج نشد'}`,
        userId,
      );
    } catch {
      analysis = {
        guessedStrategyFa: 'تحلیل LLM در دسترس نبود؛ بررسی دستی لازم است.',
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
