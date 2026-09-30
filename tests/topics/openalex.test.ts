import { describe, expect, it } from 'vitest';
import { openAlexGet, stripId } from '../../src/lib/topics/openalex';

function stub(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>,
) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return {
    urls,
    sleeps,
    opts: {
      mailto: 'a@b.c',
      apiKey: 'SECRET',
      fetchImpl,
      sleepImpl: async (ms: number) => void sleeps.push(ms),
    },
  };
}

describe('openAlexGet', () => {
  it('sends mailto, the key and the params', async () => {
    const s = stub([{ status: 200, body: { meta: { count: 3 } } }]);
    const r = await openAlexGet<{ meta: { count: number } }>(
      '/works',
      { filter: 'topics.id:T1|T2' },
      s.opts,
    );
    expect(r.meta.count).toBe(3);
    const u = new URL(s.urls[0]!);
    expect(u.pathname).toBe('/works');
    expect(u.searchParams.get('filter')).toBe('topics.id:T1|T2');
    expect(u.searchParams.get('mailto')).toBe('a@b.c');
    expect(u.searchParams.get('api_key')).toBe('SECRET');
  });

  it('waits out a 429 using Retry-After, then succeeds', async () => {
    const s = stub([
      { status: 429, headers: { 'Retry-After': '7' } },
      { status: 200, body: { ok: 1 } },
    ]);
    expect(await openAlexGet('/works', {}, s.opts)).toEqual({ ok: 1 });
    expect(s.sleeps).toEqual([7000]);
  });

  it('retries a 5xx and a dropped connection, and gives up after three attempts', async () => {
    const s = stub([{ status: 503 }, new TypeError('fetch failed'), { status: 502 }]);
    await expect(openAlexGet('/works', {}, s.opts)).rejects.toThrow(/HTTP 502/);
    expect(s.urls).toHaveLength(3);
  });

  it('does not retry a 400, and never puts the key in the error', async () => {
    const s = stub([{ status: 400, body: { error: 'bad filter' } }]);
    const e = await openAlexGet('/works', { filter: 'x' }, s.opts).catch((x: Error) => x);
    expect(String(e)).toMatch(/HTTP 400/);
    expect(String(e)).not.toContain('SECRET');
    expect(s.urls).toHaveLength(1);
  });

  it('omits api_key when none is set', async () => {
    const s = stub([{ status: 200 }]);
    await openAlexGet('/topics', {}, { ...s.opts, apiKey: undefined });
    expect(new URL(s.urls[0]!).searchParams.has('api_key')).toBe(false);
  });
});

describe('stripId', () => {
  it('drops the openalex.org prefix', () => {
    expect(stripId('https://openalex.org/T11948')).toBe('T11948');
    expect(stripId('I27837315')).toBe('I27837315');
  });
});
