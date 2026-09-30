import { describe, expect, it } from 'vitest';
import { runSnapshot } from '../../scripts/topics/snapshot';

const R = '/repos/acme/compchem-events';
function gh(responses: Record<string, { status: number; body?: unknown }>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const s = responses[key];
    if (!s) throw new Error(`unstubbed: ${key}`);
    return new Response(JSON.stringify(s.body ?? {}), { status: s.status });
  }) as typeof fetch;
  return { calls, github: { token: 't', repo: 'acme/compchem-events', fetchImpl } };
}
const openalexOk = (async (input: RequestInfo | URL) => {
  const u = new URL(String(input));
  if (u.searchParams.get('group_by')) return new Response('{"group_by":[]}', { status: 200 });
  return new Response('{"meta":{"count":0},"results":[]}', { status: 200 });
}) as typeof fetch;
const topics = [{ slug: 'dft', label: 'DFT', openalex: ['T1'] }];
const BRANCH = 'data/topic-stats-2026-10';

describe('runSnapshot', () => {
  it('opens a labelled PR on the monthly branch with the snapshot file', async () => {
    const g = gh({
      [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 404 },
      [`GET ${R}`]: { status: 200, body: { default_branch: 'main' } },
      [`GET ${R}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 's' } } },
      [`POST ${R}/git/refs`]: { status: 201 },
      [`GET ${R}/contents/data/topic-stats.json?ref=${BRANCH}`]: { status: 404 },
      [`PUT ${R}/contents/data/topic-stats.json`]: { status: 201 },
      [`POST ${R}/pulls`]: { status: 201, body: { number: 70 } },
      [`POST ${R}/issues/70/labels`]: { status: 200 },
      [`GET ${R}/issues?state=open&labels=topic-stats-failures`]: {
        status: 200,
        body: [{ number: 9, title: 'Topic statistics snapshot failed' }],
      },
      [`PATCH ${R}/issues/9`]: { status: 200 },
    });
    const r = await runSnapshot({
      github: g.github,
      openalex: { mailto: 'a@b.c', fetchImpl: openalexOk },
      today: '2026-10-02',
      topics,
      previous: undefined,
    });
    expect(r).toEqual({ outcome: 'opened', pr: 70 });
    const put = g.calls.find((c) => c.key.startsWith('PUT '))!.body as { content: string };
    const written = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
    expect(written.topics.dft.works_by_year).toHaveLength(15);
    const labels = g.calls.find((c) => c.key.endsWith('/labels'))!.body as { labels: string[] };
    expect(labels.labels).toEqual(['data']);
    // A good month closes last month's failure issue.
    const closed = g.calls.find((c) => c.key === `PATCH ${R}/issues/9`)!.body as { state: string };
    expect(closed.state).toBe('closed');
  });

  it('proposes nothing and reports topic-stats when OpenAlex fails', async () => {
    const g = gh({
      [`GET ${R}/issues?state=open&labels=topic-stats-failures`]: { status: 200, body: [] },
      [`POST ${R}/issues`]: { status: 201, body: { number: 5 } },
    });
    const failing = (async () => new Response('{}', { status: 400 })) as typeof fetch;
    const r = await runSnapshot({
      github: g.github,
      openalex: { mailto: 'a@b.c', fetchImpl: failing },
      today: '2026-10-02',
      topics,
      previous: undefined,
    });
    expect(r.outcome).toBe('failed');
    expect(g.calls.some((c) => c.key.includes('/git/') || c.key.includes('/pulls'))).toBe(false);
    // Its own issue, so the nightly discovery run's sync can neither overwrite nor close it.
    const issue = g.calls.find((c) => c.key === `POST ${R}/issues`)!.body as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(issue.title).toBe('Topic statistics snapshot failed');
    expect(issue.labels).toEqual(['topic-stats-failures']);
    expect(issue.body).toContain('topic-stats');
  });
});
