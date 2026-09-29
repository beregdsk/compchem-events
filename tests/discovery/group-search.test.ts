import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl, searchGroupWebsites } from '../../src/lib/discovery/group-search';

function stubSearch(message: unknown, seen: { body?: Record<string, unknown> } = {}) {
  return (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message }], usage: { total_tokens: 10 } }), {
      status: 200,
    });
  }) as typeof fetch;
}

const opts = (fetchImpl: typeof fetch) => ({
  apiKey: 'k',
  model: 'm',
  topics: [],
  fetchImpl,
  sleepImpl: async () => {},
});

describe('isPublicHttpsUrl', () => {
  it.each([
    'http://lab.example/',
    'https://localhost/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://10.0.0.2/',
    'https://printer.local/',
    'https://localhost./',
    'https://printer.local./',
    'https://metadata.google.internal./',
    'not a url',
  ])('rejects %s', (u) => {
    expect(isPublicHttpsUrl(u)).toBe(false);
  });

  it('accepts a public https host', () => {
    expect(isPublicHttpsUrl('https://www.epfl.ch/labs/cosmo/')).toBe(true);
  });

  it('accepts a public host written with a trailing dot', () => {
    expect(isPublicHttpsUrl('https://www.epfl.ch./labs/cosmo/')).toBe(true);
  });
});

describe('searchGroupWebsites', () => {
  it('asks OpenRouter with the web plugin and returns citation URLs only', async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const urls = await searchGroupWebsites(
      '"Michele Ceriotti" research group',
      opts(
        stubSearch(
          {
            content:
              'The group is at https://not-cited.example/ and https://www.epfl.ch/labs/cosmo/.',
            annotations: [
              {
                type: 'url_citation',
                url_citation: { url: 'https://www.epfl.ch/labs/cosmo/', title: 'COSMO' },
              },
              {
                type: 'url_citation',
                url_citation: { url: 'http://insecure.example/', title: 'x' },
              },
              { type: 'url_citation', url_citation: { url: 'https://10.1.1.1/', title: 'x' } },
              {
                type: 'url_citation',
                url_citation: { url: 'https://www.epfl.ch/labs/cosmo/', title: 'dup' },
              },
            ],
          },
          seen,
        ),
      ),
    );
    expect(urls).toEqual(['https://www.epfl.ch/labs/cosmo/']);
    expect(seen.body?.plugins).toEqual([{ id: 'web', max_results: 5 }]);
  });

  it('returns nothing when the response has no citations', async () => {
    expect(
      await searchGroupWebsites('x', opts(stubSearch({ content: 'https://prose.example/' }))),
    ).toEqual([]);
  });

  it('waits out a 429 for the stated reset, then retries', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{}', { status: 429, headers: { 'retry-after': '7' } });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                annotations: [
                  { type: 'url_citation', url_citation: { url: 'https://a.example/' } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const urls = await searchGroupWebsites('x', {
      ...opts(fetchImpl),
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    expect(urls).toEqual(['https://a.example/']);
    expect(waits).toEqual([7000]);
  });
});
