import { ConsoleLogger } from '@nestjs/common';
import { ObservedErrorService } from './observed-error.service';

export class ObservedErrorLogger extends ConsoleLogger {
  constructor(private readonly observed: ObservedErrorService) {
    super();
  }

  error(message: unknown, stack?: string, context?: string): void {
    super.error(message, stack, context);
    const text = toText(message);
    if (text.startsWith('اینجست بازار ناموفق') || text.startsWith('اینجست اختیار ناموفق')) return;
    const detail = [text, stack].filter(Boolean).join('\n');
    void this.observed.record({
      purpose: context?.trim() || 'system',
      message: text,
      detail,
    });
  }
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
