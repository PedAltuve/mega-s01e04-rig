import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunLine } from './types.js';

function parseLine(line: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.at !== 'string' ||
    typeof input.job !== 'string' ||
    (input.status !== 'ok' && input.status !== 'retry' && input.status !== 'fail') ||
    (input.owner !== undefined && input.owner !== null && typeof input.owner !== 'string') ||
    (input.error !== undefined && typeof input.error !== 'string')
  ) return null;

  return {
    at: input.at,
    job: input.job,
    status: input.status,
    owner: input.owner ?? null,
    error: input.error,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (run === null) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const row = jobs.get(run.job);
    if (row) {
      row.runs++;
      row.retries += run.status === 'retry' ? 1 : 0;
      row.lastStatus = run.status;
      row.lastError = run.error ?? null;
      row.owner = run.owner;
      row.lastAt = run.at;
    } else {
      jobs.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
    }
  }
  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, counts };
};
