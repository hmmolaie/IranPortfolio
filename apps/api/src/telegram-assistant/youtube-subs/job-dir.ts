import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export function tempRoot(): string {
  const raw = (process.env.TEMP_DIR ?? '').trim();
  return raw || path.join(os.tmpdir(), 'sabadyar-jobs');
}

export function jobDirFor(jobId: string): string {
  if (!/^[a-f0-9]{8,32}$/i.test(jobId)) {
    throw new Error('job id نامعتبر است');
  }
  const root = path.resolve(tempRoot());
  const dir = path.resolve(root, jobId);
  if (!dir.startsWith(root + path.sep)) {
    throw new Error('مسیر job نامعتبر است');
  }
  return dir;
}

export async function createJobDir(jobId: string): Promise<string> {
  const dir = jobDirFor(jobId);
  await fs.mkdir(path.join(dir, 'fonts'), { recursive: true });
  return dir;
}

export async function cleanupJobDir(jobId: string): Promise<void> {
  const dir = jobDirFor(jobId);
  await fs.rm(dir, { recursive: true, force: true });
}
