import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildWeightedGraph, type BuiltGraph, type ForexAnalysis } from './forex-analyze';
import { fetchForexQuotes } from './forex-quotes';
import { currencyMeta } from './forex-universe';

const KEEP_SNAPSHOTS = 48;
const STALE_MS = 4 * 60 * 1000;

export type ForexSnapshotDto = {
  id: string;
  capturedAt: string;
  source: string;
  nodeCount: number;
  edgeCount: number;
  pairCount: number;
  nodes: BuiltGraph['nodes'];
  edges: BuiltGraph['edges'];
  analysis: ForexAnalysis;
};

@Injectable()
export class ForexService {
  private readonly logger = new Logger(ForexService.name);
  private refreshInFlight: Promise<ForexSnapshotDto> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 */5 * * * *')
  async scheduledRefresh() {
    try {
      await this.refresh();
    } catch (e) {
      this.logger.warn(`کرون گراف فارکس ناموفق: ${(e as Error).message}`);
    }
  }

  async latest(): Promise<ForexSnapshotDto> {
    const row = await this.prisma.forexSnapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
      include: { nodes: true, edges: true },
    });
    const age = row ? Date.now() - row.capturedAt.getTime() : Number.POSITIVE_INFINITY;
    if (!row || age > STALE_MS) {
      try {
        return await this.refresh();
      } catch (e) {
        if (row) return this.toDto(row);
        throw e;
      }
    }
    return this.toDto(row);
  }

  listSnapshots() {
    return this.prisma.forexSnapshot.findMany({
      orderBy: { capturedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        capturedAt: true,
        source: true,
        nodeCount: true,
        edgeCount: true,
        pairCount: true,
      },
    });
  }

  async getSnapshot(id: string): Promise<ForexSnapshotDto> {
    const row = await this.prisma.forexSnapshot.findUnique({
      where: { id },
      include: { nodes: true, edges: true },
    });
    if (!row) throw new NotFoundException('اسنپ‌شات گراف پیدا نشد');
    return this.toDto(row);
  }

  refresh(): Promise<ForexSnapshotDto> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.runRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async runRefresh(): Promise<ForexSnapshotDto> {
    const { quotes, sources } = await fetchForexQuotes();
    if (quotes.length < 8) {
      throw new ServiceUnavailableException(
        'نرخ کافی از یاهو/منابع کمکی دریافت نشد. بعداً دوباره تلاش کنید.',
      );
    }

    const graph = buildWeightedGraph(quotes);
    const capturedAt = new Date();
    const source = sources.join(',') || 'yahoo';

    const created = await this.prisma.forexSnapshot.create({
      data: {
        capturedAt,
        source,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        pairCount: graph.pairCount,
        analysisJson: graph.analysis as unknown as Prisma.InputJsonValue,
        nodes: {
          create: graph.nodes.map((n) => ({
            code: n.code,
            nameFa: n.nameFa,
            kind: n.kind,
          })),
        },
        edges: {
          create: graph.edges.map((e) => ({
            fromCode: e.from,
            toCode: e.to,
            rate: e.rate,
            pairSymbol: e.pairSymbol,
            yahooSymbol: e.yahooSymbol,
            source: e.source,
            inverted: e.inverted,
          })),
        },
      },
      include: { nodes: true, edges: true },
    });

    await this.pruneOld();
    this.logger.log(
      `گراف فارکس ذخیره شد: ${graph.pairCount} جفت، ${graph.nodes.length} رأس، سیگنال ${graph.analysis.signalCount}`,
    );
    return this.toDto(created);
  }

  private async pruneOld() {
    const extra = await this.prisma.forexSnapshot.findMany({
      orderBy: { capturedAt: 'desc' },
      skip: KEEP_SNAPSHOTS,
      select: { id: true },
    });
    if (!extra.length) return;
    await this.prisma.forexSnapshot.deleteMany({
      where: { id: { in: extra.map((x) => x.id) } },
    });
  }

  private toDto(row: {
    id: string;
    capturedAt: Date;
    source: string;
    nodeCount: number;
    edgeCount: number;
    pairCount: number;
    analysisJson: Prisma.JsonValue | null;
    nodes: Array<{ code: string; nameFa: string; kind: string }>;
    edges: Array<{
      fromCode: string;
      toCode: string;
      rate: number;
      pairSymbol: string;
      yahooSymbol: string | null;
      source: string;
      inverted: boolean;
    }>;
  }): ForexSnapshotDto {
    const nodes = row.nodes.map((n) => {
      const meta = currencyMeta(n.code);
      return {
        code: n.code,
        nameFa: n.nameFa || meta.nameFa,
        kind: (n.kind as 'FIAT' | 'CRYPTO' | 'METAL') || meta.kind,
      };
    });
    const edges = row.edges.map((e) => ({
      from: e.fromCode,
      to: e.toCode,
      rate: e.rate,
      pairSymbol: e.pairSymbol,
      inverted: e.inverted,
      source: e.source,
      yahooSymbol: e.yahooSymbol,
    }));
    const rebuilt = buildWeightedGraph(
      edges
        .filter((e) => !e.inverted)
        .map((e) => {
          const [base, quote] = e.pairSymbol.split('/');
          return {
            base: base ?? e.from,
            quote: quote ?? e.to,
            pairSymbol: e.pairSymbol,
            rate: e.rate,
            yahooSymbol: e.yahooSymbol ?? '',
            source: e.source,
          };
        }),
    );
    return {
      id: row.id,
      capturedAt: row.capturedAt.toISOString(),
      source: row.source,
      nodeCount: row.nodeCount,
      edgeCount: row.edgeCount,
      pairCount: row.pairCount,
      nodes: nodes.length ? nodes : rebuilt.nodes,
      edges: edges.length ? edges : rebuilt.edges,
      analysis: isAnalysis(row.analysisJson) ? row.analysisJson : rebuilt.analysis,
    };
  }
}

function isAnalysis(v: Prisma.JsonValue | null): v is Prisma.JsonValue & ForexAnalysis {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const rec = v as Record<string, unknown>;
  return Array.isArray(rec.narrativeFa) && Array.isArray(rec.opportunities);
}
