// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing at the edge.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job for the night. Times keep the offset from the log.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Valid lines per status, including every run of a job.
  counts: { ok: number; retry: number; fail: number };
  // Sorted by job, so the page and the JSON agree on order (ADR 0001).
  rows: DigestRow[];
  // Lines that did not parse: counted, never thrown.
  badLines: number;
};

// Returns null when runs/<night>.jsonl does not exist; an empty file is a Night with no rows.
export type ReadNight = (runsDir: string, night: string) => Night | null;
