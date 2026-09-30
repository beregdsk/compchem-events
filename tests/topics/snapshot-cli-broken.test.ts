import { describe, expect, it, vi } from 'vitest';

// The committed snapshot is unreadable (hand-edited, or stale after a slug
// was removed): the job must still report, not crash before its try.
vi.mock('../../src/lib/topic-stats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/topic-stats')>()),
  loadTopicStats: () => {
    throw new Error('topic statistics are invalid');
  },
}));

const { runSnapshot } = await import('../../scripts/topics/snapshot');

describe('runSnapshot with an unreadable previous snapshot', () => {
  it('still builds the new one, treating the old as absent', async () => {
    const R = '/repos/acme/compchem-events';
    const keys: string[] = [];
    const gh = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
      keys.push(key);
      return new Response('{}', {
        status: key === `GET ${R}/issues?state=open&labels=topic-stats-failures` ? 200 : 500,
      });
    }) as typeof fetch;
    const failing = (async () => new Response('{}', { status: 400 })) as typeof fetch;
    const r = await runSnapshot({
      github: { token: 't', repo: 'acme/compchem-events', fetchImpl: gh },
      openalex: { mailto: 'a@b.c', fetchImpl: failing },
      today: '2026-10-02',
      topics: [{ slug: 'dft', label: 'DFT', openalex: ['T1'] }],
    });
    // It got as far as OpenAlex (which fails here) and reported that, instead of throwing.
    expect(r.outcome).toBe('failed');
    expect(r.error).toMatch(/OpenAlex/);
  });
});
