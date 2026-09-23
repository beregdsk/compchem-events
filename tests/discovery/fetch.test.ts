import { describe, expect, it } from 'vitest';
import { politeFetch, robotsAllows, type FetchOptions } from '../../src/lib/discovery/fetch';
import { emptyState } from '../../src/lib/discovery/state';

function stubFetch(
  responses: Record<string, { status: number; body: string; headers?: Record<string, string> }>,
) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const r = responses[url];
    if (!r) throw new Error(`unstubbed url: ${url}`);
    void init;
    return new Response(r.body, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { impl, calls };
}

function baseOptions(overrides: Partial<FetchOptions> = {}): FetchOptions {
  return {
    state: emptyState(),
    userAgent: 'Test Agent (+https://example.org)',
    sleepImpl: async () => {},
    now: () => new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('robotsAllows', () => {
  it('allows everything when there are no rules', () => {
    expect(robotsAllows('', '/anything')).toBe(true);
  });

  it('disallows a path under a wildcard user-agent group', () => {
    const robots = 'User-agent: *\nDisallow: /private/\n';
    expect(robotsAllows(robots, '/private/page')).toBe(false);
    expect(robotsAllows(robots, '/public/page')).toBe(true);
  });

  it('ignores Disallow lines outside a wildcard group', () => {
    const robots = 'User-agent: SomeOtherBot\nDisallow: /everything\n';
    expect(robotsAllows(robots, '/everything')).toBe(true);
  });
});

describe('politeFetch', () => {
  it('fetches a new page and records its state', async () => {
    const { impl, calls } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': {
        status: 200,
        body: 'hello',
        headers: { etag: 'W/"abc"' },
      },
    });
    const options = baseOptions({ fetchImpl: impl });
    const result = await politeFetch('https://example.org/page', options);
    expect(result).toEqual({ status: 'fetched', body: 'hello' });
    expect(calls).toContain('https://example.org/page');
    expect(options.state.pages['https://example.org/page']!.etag).toBe('W/"abc"');
    expect(options.state.hosts['example.org']!.lastRequestAt).toBe('2026-09-23T00:00:00.000Z');
  });

  it('skips a robots.txt-disallowed path without fetching it', async () => {
    const { impl, calls } = stubFetch({
      'https://example.org/robots.txt': {
        status: 200,
        body: 'User-agent: *\nDisallow: /private/\n',
      },
    });
    const result = await politeFetch(
      'https://example.org/private/page',
      baseOptions({ fetchImpl: impl }),
    );
    expect(result).toEqual({ status: 'skipped', reason: 'robots-disallowed' });
    expect(calls).not.toContain('https://example.org/private/page');
  });

  it('treats a matching content hash as unchanged even without an ETag', async () => {
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': { status: 200, body: 'same body' },
    });
    const state = emptyState();
    const first = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, state }),
    );
    expect(first.status).toBe('fetched');
    const second = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, state }),
    );
    expect(second).toEqual({ status: 'unchanged' });
  });

  it('sleeps to respect the per-host rate limit on a second request', async () => {
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/a': { status: 200, body: 'a' },
      'https://example.org/b': { status: 200, body: 'b' },
    });
    const sleeps: number[] = [];
    const state = emptyState();
    let now = new Date('2026-09-23T00:00:00.000Z');
    const options = baseOptions({
      fetchImpl: impl,
      state,
      sleepImpl: async (ms) => {
        sleeps.push(ms);
      },
      now: () => now,
      minHostIntervalMs: 5000,
    });
    await politeFetch('https://example.org/a', options);
    now = new Date('2026-09-23T00:00:01.000Z');
    await politeFetch('https://example.org/b', options);
    expect(sleeps).toEqual([4000]);
  });

  it('reports a non-2xx response as an error', async () => {
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/missing': { status: 404, body: 'not found' },
    });
    const result = await politeFetch(
      'https://example.org/missing',
      baseOptions({ fetchImpl: impl }),
    );
    expect(result).toEqual({ status: 'error', error: '404 ' });
  });

  it('treats a robots.txt fetch failure as allow-all', async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/robots.txt')) throw new Error('network down');
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const result = await politeFetch('https://example.org/page', baseOptions({ fetchImpl: impl }));
    expect(result.status).toBe('fetched');
  });
});
