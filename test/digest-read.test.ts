import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

function tempRuns() {
  return mkdtempSync(join(tmpdir(), 'rig-digest-'));
}

function readLines(lines: string[]) {
  const runsDir = tempRuns();
  writeFileSync(join(runsDir, 'night.jsonl'), lines.join('\n'));
  return readNight(runsDir, 'night');
}

describe('readNight', () => {
  it('reads the fixture, sorts jobs, and preserves times and final outcomes', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night?.night).toBe('2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(night?.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(night?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(night?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' });
    expect(night?.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('returns null for a missing night', () => {
    expect(readNight(tempRuns(), 'missing')).toBeNull();
  });

  it.each(['', '\n  \n\t\r\n'])('ignores empty or blank-only files (%j)', content => {
    expect(readLines([content])).toEqual({ night: 'night', rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed JSON while retaining valid lines', () => {
    expect(readLines([
      'not json', '', '  ',
      JSON.stringify({ at: 'first+01:00', job: 'job', status: 'ok' }),
    ])).toEqual({
      night: 'night', badLines: 1, counts: { ok: 1, retry: 0, fail: 0 },
      rows: [{ job: 'job', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt: 'first+01:00', lastAt: 'first+01:00' }],
    });
  });

  it.each([
    null, [], 1, 'text', {},
    { at: 1, job: 'job', status: 'ok' },
    { at: 'time', job: 1, status: 'ok' },
    { at: 'time', job: 'job', status: 'unknown' },
    { at: 'time', job: 'job', status: 'ok', owner: 1 },
    { at: 'time', job: 'job', status: 'ok', error: null },
  ])('counts invalid line shapes (%j)', value => {
    expect(readLines([JSON.stringify(value)])).toEqual({ night: 'night', rows: [], badLines: 1, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('uses file order, updates owners, and sorts with plain string comparison', () => {
    const night = readLines([
      JSON.stringify({ at: 'later+01:00', job: '__proto__', status: 'retry', owner: 'first', error: 'old' }),
      JSON.stringify({ at: 'time', job: 'a', status: 'ok', owner: null }),
      JSON.stringify({ at: 'time', job: 'Z', status: 'ok', owner: null }),
      JSON.stringify({ at: 'earlier+02:00', job: '__proto__', status: 'fail', owner: 'last', error: 'new' }),
    ]);
    expect(night?.counts).toEqual({ ok: 2, retry: 1, fail: 1 });
    expect(night?.rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a']);
    expect(night?.rows[1]).toEqual({
      job: '__proto__', owner: 'last', runs: 2, retries: 1,
      lastStatus: 'fail', lastError: 'new', firstAt: 'later+01:00', lastAt: 'earlier+02:00',
    });
  });
});
