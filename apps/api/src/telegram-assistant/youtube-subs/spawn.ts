import { spawn } from 'child_process';

export class ProcessTimedOut extends Error {
  constructor() {
    super('زمان دستور تمام شد');
    this.name = 'ProcessTimedOut';
  }
}

export class PermanentHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentHttpError';
  }
}

export function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ProcessTimedOut()));
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => finish(() => resolve({ code: code ?? 1, stdout, stderr })));
  });
}

export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ProcessTimedOut || e instanceof PermanentHttpError) throw e;
      last = e;
      if (i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}
