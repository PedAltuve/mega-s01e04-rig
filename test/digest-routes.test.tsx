import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';
import type { Night, RunLine } from '../src/digest/types.js';

const normalNight = '2026-10-28';
const emptyNight = '2026-10-27';
const badLineNight = '2026-10-26';
const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
const app = createApp({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

function run(job: string, status: RunLine['status']): RunLine {
  return { at: '2026-10-28T02:00:00+01:00', job, status, owner: 'rook' };
}

// Deliberately unsorted; include both warning conditions and the boundary below three retries.
const normalLines = [
  run('zeta-failed', 'fail'),
  run('beta-three-retries', 'retry'),
  run('alpha-clean', 'ok'),
  run('gamma-two-retries', 'retry'),
  run('beta-three-retries', 'retry'),
  run('gamma-two-retries', 'retry'),
  run('beta-three-retries', 'retry'),
  run('beta-three-retries', 'ok'),
  run('gamma-two-retries', 'ok'),
];

function pageRows(html: string) {
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  return [...body.matchAll(/<tr([^>]*)><td>([^<]*)<\/td>[\s\S]*?<\/tr>/g)].map(
    (match) => ({ job: match[2], warn: /class="warn"/.test(match[1]) }),
  );
}

describe('digest routes', () => {
  beforeAll(() => {
    vi.stubEnv('LANE_ID', 'digest-test-lane');
    vi.stubEnv('LANE_MARKER', 'DIGEST-ROUTE-MARKER');
    writeFileSync(join(runsDir, `${normalNight}.jsonl`), normalLines.map((line) => JSON.stringify(line)).join('\n'));
    writeFileSync(join(runsDir, `${emptyNight}.jsonl`), '');
    writeFileSync(join(runsDir, `${badLineNight}.jsonl`), [
      JSON.stringify(run('before-bad-line', 'ok')),
      'not valid JSON',
      JSON.stringify(run('after-bad-line', 'fail')),
    ].join('\n'));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('serves the lane banner and every job, with JSON rows matching the reader', async () => {
    const page = await app.request(`/digest/${normalNight}`);
    const json = await app.request(`/api/digest/${normalNight}`);
    expect([page.status, json.status]).toEqual([200, 200]);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(json.headers.get('content-type')).toContain('application/json');
    const html = await page.text();
    expect(html).toContain('<header><strong>rig</strong><span>digest-test-lane</span>');
    expect(html).toContain('<span class="marker">DIGEST-ROUTE-MARKER</span>');
    const expected = readNight(runsDir, normalNight);
    expect(expected).not.toBeNull();
    for (const row of expected!.rows) expect(html).toContain(`<td>${row.job}</td>`);
    const digest: Night = await json.json();
    expect(digest.rows).toEqual(expected!.rows);
  });

  it.each(['2026-10-25', 'not-a-night'])('returns 404 from both routes for %s', async (night) => {
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect([page.status, json.status]).toEqual([404, 404]);
    expect(await page.text()).toContain('night not found');
    expect(await json.json()).toEqual({ error: 'no such night' });
  });

  it('serves an empty night as nothing ran and an empty JSON row list', async () => {
    const page = await app.request(`/digest/${emptyNight}`);
    const json = await app.request(`/api/digest/${emptyNight}`);
    expect([page.status, json.status]).toEqual([200, 200]);
    expect(await page.text()).toContain('nothing ran');
    const digest: Night = await json.json();
    expect(digest.rows).toEqual([]);
  });

  it('keeps valid jobs and reports a single bad line in both representations', async () => {
    const page = await app.request(`/digest/${badLineNight}`);
    const json = await app.request(`/api/digest/${badLineNight}`);
    expect([page.status, json.status]).toEqual([200, 200]);
    const html = await page.text();
    expect(html).toContain('1 line could not be read');
    const digest: Night = await json.json();
    expect(digest.badLines).toBe(1);
    expect(digest.rows).toEqual(readNight(runsDir, badLineNight)!.rows);
    expect(digest.rows.map((row) => row.job)).toEqual(['after-bad-line', 'before-bad-line']);
    expect(pageRows(html).map((row) => row.job)).toEqual(['after-bad-line', 'before-bad-line']);
  });

  it('lists the same jobs in sorted order on the page and in JSON', async () => {
    const page = await app.request(`/digest/${normalNight}`);
    const json = await app.request(`/api/digest/${normalNight}`);
    const digest: Night = await json.json();
    const jsonJobs = digest.rows.map((row) => row.job);
    expect(jsonJobs).toEqual(['alpha-clean', 'beta-three-retries', 'gamma-two-retries', 'zeta-failed']);
    expect(pageRows(await page.text()).map((row) => row.job)).toEqual(jsonJobs);
  });

  it('warns for three retries or a final failure, but not two retries or a clean job', async () => {
    const page = await app.request(`/digest/${normalNight}`);
    expect(pageRows(await page.text())).toEqual([
      { job: 'alpha-clean', warn: false },
      { job: 'beta-three-retries', warn: true },
      { job: 'gamma-two-retries', warn: false },
      { job: 'zeta-failed', warn: true },
    ]);
  });
});
