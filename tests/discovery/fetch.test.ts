import { describe, expect, it } from 'vitest';
import {
  looksLikeBotChallenge,
  politeFetch,
  robotsAllows,
  type FetchOptions,
} from '../../src/lib/discovery/fetch';
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

  it('strips an inline comment before matching a Disallow value (Fix I.1)', () => {
    const robots = 'User-agent: *\nDisallow: /private/ # internal note\n';
    expect(robotsAllows(robots, '/private/page')).toBe(false);
  });

  it('keeps a wildcard group current through consecutive User-agent lines (Fix I.2)', () => {
    const robots = 'User-agent: *\nUser-agent: SomeBot\nDisallow: /x\n';
    expect(robotsAllows(robots, '/x')).toBe(false);
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

  it('falls back to a browser render when a 200 response is a bot-challenge shell', async () => {
    // Confirmed live for ACS: Incapsula returns 200 with a tiny iframe
    // shell for a plain fetch, but real content for a real browser.
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': {
        status: 200,
        body: '<html><body><iframe src="/_Incapsula_Resource?..."></iframe></body></html>',
      },
    });
    const browserCalls: string[] = [];
    const browserFetchImpl = async (url: string) => {
      browserCalls.push(url);
      return '<html><body><h1>Real rendered content</h1></body></html>';
    };
    const result = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, browserFetchImpl }),
    );
    expect(result).toEqual({
      status: 'fetched',
      body: '<html><body><h1>Real rendered content</h1></body></html>',
    });
    expect(browserCalls).toEqual(['https://example.org/page']);
  });

  it('falls back to a browser render on a 403 challenge response', async () => {
    // Confirmed live for RSC-style WAF blocks: 403 with no body at all.
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': { status: 403, body: '' },
    });
    const browserFetchImpl = async () => '<html><body><h1>Real content</h1></body></html>';
    const result = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, browserFetchImpl }),
    );
    expect(result).toEqual({
      status: 'fetched',
      body: '<html><body><h1>Real content</h1></body></html>',
    });
  });

  it('reports the plain error when a challenge is detected but no browser fallback is configured', async () => {
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': { status: 403, body: '' },
    });
    const result = await politeFetch('https://example.org/page', baseOptions({ fetchImpl: impl }));
    expect(result).toEqual({ status: 'error', error: '403 ' });
  });

  it('does not invoke the browser fallback for an ordinary large page', async () => {
    const { impl } = stubFetch({
      'https://example.org/robots.txt': { status: 200, body: '' },
      'https://example.org/page': { status: 200, body: '<html>real content</html>'.repeat(500) },
    });
    let browserCalled = false;
    const browserFetchImpl = async () => {
      browserCalled = true;
      return 'should never be used';
    };
    const result = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, browserFetchImpl }),
    );
    expect(result.status).toBe('fetched');
    expect(browserCalled).toBe(false);
  });
});

describe('looksLikeBotChallenge', () => {
  it('treats a 403 as a challenge regardless of body', () => {
    expect(looksLikeBotChallenge(403, '')).toBe(true);
  });

  it('treats a small body carrying a known challenge signature as a challenge', () => {
    expect(looksLikeBotChallenge(200, 'Request blocked. Incapsula incident ID: 123')).toBe(true);
    expect(looksLikeBotChallenge(200, '<title>Just a moment...</title>')).toBe(true);
  });

  it('does not treat an ordinary large page as a challenge', () => {
    expect(looksLikeBotChallenge(200, '<html>real content</html>'.repeat(500))).toBe(false);
  });

  it('does not treat an ordinary small page with no signature as a challenge', () => {
    expect(looksLikeBotChallenge(200, '<html><body>Not found</body></html>')).toBe(false);
  });

  it('treats a robots.txt fetch failure as allow-all', async () => {
    const impl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/robots.txt')) throw new Error('network down');
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const result = await politeFetch('https://example.org/page', baseOptions({ fetchImpl: impl }));
    expect(result.status).toBe('fetched');
  });

  it('does not cache a robots.txt fetch failure, retrying it on the next call', async () => {
    const state = emptyState();
    let robotsCalls = 0;
    const impl = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) {
        robotsCalls += 1;
        if (robotsCalls === 1) throw new Error('network down');
        return new Response('User-agent: *\nDisallow: /private/\n', { status: 200 });
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const first = await politeFetch(
      'https://example.org/page',
      baseOptions({ fetchImpl: impl, state }),
    );
    expect(first.status).toBe('fetched');
    expect(state.hosts['example.org']?.robotsTxt).toBeUndefined();

    const second = await politeFetch(
      'https://example.org/private/page',
      baseOptions({ fetchImpl: impl, state }),
    );
    expect(second).toEqual({ status: 'skipped', reason: 'robots-disallowed' });
    expect(robotsCalls).toBe(2);
  });

  it('returns unchanged on a 304 response and refreshes fetchedAt', async () => {
    const state = emptyState();
    const url = 'https://example.org/page';
    state.pages[url] = {
      etag: 'W/"abc"',
      contentHash: 'deadbeef',
      fetchedAt: '2026-09-01T00:00:00.000Z',
    };
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) return new Response('', { status: 200 });
      if (u === url) {
        const headers = new Headers(init?.headers);
        expect(headers.get('If-None-Match')).toBe('W/"abc"');
        return new Response(null, { status: 304 });
      }
      throw new Error(`unstubbed url: ${u}`);
    }) as typeof fetch;

    const result = await politeFetch(url, baseOptions({ fetchImpl: impl, state }));
    expect(result).toEqual({ status: 'unchanged' });
    expect(state.pages[url]).toEqual({
      etag: 'W/"abc"',
      contentHash: 'deadbeef',
      fetchedAt: '2026-09-23T00:00:00.000Z',
    });
  });

  it('re-fetches robots.txt when the cached copy is more than 24 hours old (Fix H)', async () => {
    const state = emptyState();
    state.hosts['example.org'] = {
      robotsTxt: 'User-agent: *\nDisallow: /old/\n',
      robotsFetchedAt: '2026-09-21T00:00:00.000Z',
    };
    let robotsCalls = 0;
    const impl = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) {
        robotsCalls += 1;
        return new Response('User-agent: *\nDisallow: /new/\n', { status: 200 });
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const result = await politeFetch(
      'https://example.org/new/page',
      baseOptions({ fetchImpl: impl, state, now: () => new Date('2026-09-23T00:00:00.000Z') }),
    );
    expect(robotsCalls).toBe(1);
    expect(result).toEqual({ status: 'skipped', reason: 'robots-disallowed' });
    expect(state.hosts['example.org']!.robotsTxt).toBe('User-agent: *\nDisallow: /new/\n');
  });

  it('does not re-fetch robots.txt when the cached copy is recent (Fix H)', async () => {
    const state = emptyState();
    state.hosts['example.org'] = {
      robotsTxt: 'User-agent: *\nDisallow: /old/\n',
      robotsFetchedAt: '2026-09-22T23:00:00.000Z',
    };
    let robotsCalls = 0;
    const impl = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) {
        robotsCalls += 1;
        return new Response('', { status: 200 });
      }
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const result = await politeFetch(
      'https://example.org/other/page',
      baseOptions({ fetchImpl: impl, state, now: () => new Date('2026-09-23T00:00:00.000Z') }),
    );
    expect(robotsCalls).toBe(0);
    expect(result).toEqual({ status: 'fetched', body: 'ok' });
  });
});
