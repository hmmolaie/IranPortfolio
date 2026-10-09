import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AiUsageHit, aiUsageStore } from './ai-usage.sections';

@Injectable()
export class AiUsageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<{ setHeader?: (name: string, value: string) => void }>();
    return new Observable((subscriber) => {
      aiUsageStore.run({ hits: [] }, () => {
        next.handle().subscribe({
          next: (data) => {
            const hits = aiUsageStore.getStore()?.hits ?? [];
            if (hits.length) {
              res.setHeader?.('X-Ai-Usage', JSON.stringify(sumHits(hits)));
            }
            subscriber.next(attachUsage(data));
          },
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}

function attachUsage(data: unknown): unknown {
  const hits = aiUsageStore.getStore()?.hits ?? [];
  if (!hits.length) return data;
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data) || Buffer.isBuffer(data) || data instanceof StreamableFile) return data;
  return { ...(data as object), aiUsage: sumHits(hits) };
}

function sumHits(hits: AiUsageHit[]) {
  return hits.reduce(
    (sum, hit) => ({
      purpose: hit.purpose,
      sectionFa: hits.length === 1 ? hit.sectionFa : 'چند بخش',
      promptTokens: sum.promptTokens + hit.promptTokens,
      completionTokens: sum.completionTokens + hit.completionTokens,
      totalTokens: sum.totalTokens + hit.totalTokens,
      costRial: sum.costRial + hit.costRial,
      estimated: sum.estimated || hit.estimated,
    }),
    {
      purpose: hits[0]?.purpose ?? '',
      sectionFa: hits[0]?.sectionFa ?? '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costRial: 0,
      estimated: false,
    },
  );
}
