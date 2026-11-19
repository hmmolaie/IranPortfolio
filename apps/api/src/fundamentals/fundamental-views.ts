/**
 * نمای بنیادی آخرین صورت مالی هر سهم با آخرین قیمت؛ هم صفحه‌ها و هم System One و آنالیز سبد از همین می‌خوانند.
 * فقط دیتابیس و محاسبهٔ کد، بدون مدل زبانی.
 */
import type { FinancialStatement } from '@prisma/client';
import {
  FINANCIAL_REPORT_TYPE_LABELS_FA,
  type FinancialFigures,
  type FinancialReportType,
  type FundamentalSensitivity,
} from '@sabadyar/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeRatios,
  macroImpact,
  normalizeFigures,
  normalizeSensitivity,
  scoreFundamentals,
  type FundamentalRatios,
  type FundamentalScore,
  type MacroImpact,
} from './fundamental-score';
import { loadMacroDrivers, type MacroDriver } from './macro-drivers';

export type FundamentalView = {
  instrumentId: string;
  symbol: string;
  nameFa: string | null;
  price: number | null;
  priceDate: string | null;
  statementId: string;
  reportType: string | null;
  reportTypeFa: string;
  periodEndFa: string | null;
  periodMonths: number | null;
  audited: boolean | null;
  figures: FinancialFigures;
  ratios: FundamentalRatios;
  score: FundamentalScore;
  sensitivity: FundamentalSensitivity;
  macro: MacroImpact | null;
  summaryFa: string | null;
};

export function buildFundamentalView(
  row: FinancialStatement,
  inst: { id: string; symbol: string; nameFa: string | null },
  price: { price: number; date: Date } | null,
  drivers: MacroDriver[],
): FundamentalView {
  const figures = normalizeFigures(row.figures);
  const sensitivity = normalizeSensitivity(row.sensitivity);
  const ratios = computeRatios(figures, row.periodMonths, price?.price ?? null);
  const score = scoreFundamentals(ratios, figures, row.periodEndKey, row.llmScore);
  const type = (row.reportType ?? 'other') as FinancialReportType;
  return {
    instrumentId: inst.id,
    symbol: inst.symbol,
    nameFa: inst.nameFa,
    price: price?.price ?? null,
    priceDate: price?.date.toISOString() ?? null,
    statementId: row.id,
    reportType: row.reportType,
    reportTypeFa: FINANCIAL_REPORT_TYPE_LABELS_FA[type] ?? FINANCIAL_REPORT_TYPE_LABELS_FA.other,
    periodEndFa: row.periodEndFa,
    periodMonths: row.periodMonths,
    audited: row.audited,
    figures,
    ratios,
    score,
    sensitivity,
    macro: macroImpact(sensitivity, drivers),
    summaryFa: row.summaryFa,
  };
}

/** آخرین قیمت پایانی (یا آخرین معامله) هر نماد */
export async function loadLatestPrices(
  prisma: PrismaService,
  instrumentIds: string[],
): Promise<Map<string, { price: number; date: Date }>> {
  const out = new Map<string, { price: number; date: Date }>();
  if (!instrumentIds.length) return out;
  const bars = await prisma.priceBar.findMany({
    where: { instrumentId: { in: instrumentIds } },
    orderBy: { tradeDate: 'desc' },
    distinct: ['instrumentId'],
    select: { instrumentId: true, tradeDate: true, closePrice: true, lastPrice: true },
  });
  for (const bar of bars) {
    const price = bar.closePrice && bar.closePrice > 0 ? bar.closePrice : bar.lastPrice ?? 0;
    if (price > 0) out.set(bar.instrumentId, { price, date: bar.tradeDate });
  }
  return out;
}

/**
 * آخرین صورت مالی آنالیزشدهٔ هر سهم (تازه‌ترین پایان دوره، بعد تازه‌ترین بارگذاری).
 * اگر priceOverride برای نمادی داده شود (مثلاً قیمت روز در پیشنهاد سبد) همان به‌کار می‌رود.
 */
export async function loadLatestFundamentalViews(
  prisma: PrismaService,
  symbols?: string[],
  priceOverride?: Map<string, number>,
): Promise<FundamentalView[]> {
  const rows = await prisma.financialStatement.findMany({
    where: {
      analysisStatus: 'done',
      instrument: { isActive: true, ...(symbols ? { symbol: { in: symbols } } : {}) },
    },
    orderBy: [{ periodEndKey: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: { instrument: { select: { id: true, symbol: true, nameFa: true } } },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.instrumentId)) latest.set(row.instrumentId, row);
  if (!latest.size) return [];
  const [prices, drivers] = await Promise.all([
    loadLatestPrices(prisma, [...latest.keys()]),
    loadMacroDrivers(prisma).catch(() => [] as MacroDriver[]),
  ]);
  return [...latest.values()].map((row) => {
    const override = priceOverride?.get(row.instrument.symbol);
    const price =
      override && override > 0 ? { price: override, date: new Date() } : prices.get(row.instrumentId) ?? null;
    return buildFundamentalView(row, row.instrument, price, drivers);
  });
}
