import { describe, expect, it } from 'vitest';
import {
  listingSeeds,
  openalexSeedUrls,
  parentPaths,
  positionSeeds,
  registrySeeds,
  searchQueries,
  searchSeeds,
} from '../../../src/lib/discovery/crawl/seeds';

describe('parentPaths', () => {
  it('walks up to the host root', () => {
    expect(parentPaths('https://chem.uni.edu/research/groups/smith/')).toEqual([
      'https://chem.uni.edu/research/groups/',
      'https://chem.uni.edu/research/',
      'https://chem.uni.edu/',
    ]);
    expect(parentPaths('https://lab.org/')).toEqual([]);
  });
});

describe('registrySeeds', () => {
  it('seeds each website and its parents, www-stripped seed host', () => {
    const s = registrySeeds([{ website: 'https://www.uni.edu/chem/smith/' }]);
    expect(s.map((x) => [x.url, x.priority, x.seedHost])).toEqual([
      ['https://www.uni.edu/chem/smith/', 10, 'uni.edu'],
      ['https://www.uni.edu/chem/', 8, 'uni.edu'],
      ['https://www.uni.edu/', 8, 'uni.edu'],
    ]);
  });
});

describe('positionSeeds', () => {
  it('seeds the institution host root, never a job board or Telegram', () => {
    const s = positionSeeds([
      { url: 'https://www.uni.edu/jobs/123' },
      { url: 'https://t.me/quant_chem_and_stuff/668' },
      { url: 'https://constructoruniversity.wd103.myworkdayjobs.com/x' },
      { url: 'https://www.jobs.ac.uk/job/ABC' },
    ]);
    expect(s.map((x) => x.url)).toEqual(['https://www.uni.edu/']);
  });
});

describe('listingSeeds', () => {
  it('seeds only group-listing sources', () => {
    const s = listingSeeds([
      { name: 'L', url: 'https://labinitio.org/explore/', kind: 'group-listing' },
      { name: 'E', url: 'https://cecam.org/program', kind: 'listing-page' },
    ] as never);
    expect(s.map((x) => x.url)).toEqual(['https://labinitio.org/explore/']);
  });
});

describe('openalexSeedUrls', () => {
  it('ranks institutions across topics and returns their https homepages', async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      calls.push(u);
      if (u.pathname === '/institutions') {
        return new Response(
          JSON.stringify({
            results: [
              { id: 'https://openalex.org/I1', homepage_url: 'https://one.edu' },
              { id: 'https://openalex.org/I2', homepage_url: 'http://two.edu' },
              { id: 'https://openalex.org/I3', homepage_url: null },
            ],
          }),
          { status: 200 },
        );
      }
      const topic = u.searchParams.get('filter')!;
      const groups = topic.includes('T1')
        ? [
            { key: 'https://openalex.org/I2', count: 5 },
            { key: 'https://openalex.org/I1', count: 3 },
          ]
        : [
            { key: 'https://openalex.org/I1', count: 4 },
            { key: 'unknown', count: 99 },
            { key: 'https://openalex.org/I3', count: 1 },
          ];
      return new Response(JSON.stringify({ group_by: groups }), { status: 200 });
    }) as typeof fetch;
    const urls = await openalexSeedUrls(
      [
        { slug: 'a', label: 'A', openalex: ['T1'] },
        { slug: 'b', label: 'B', openalex: ['T2'] },
        { slug: 'c', label: 'C' },
      ],
      2026,
      { mailto: 'a@b.c', fetchImpl, sleepImpl: async () => {} },
    );
    // I1 has 7 works in all, I2 5: I1 first; http is upgraded; no homepage is dropped.
    expect(urls).toEqual(['https://one.edu/', 'https://two.edu/']);
    expect(calls.filter((c) => c.pathname === '/works')).toHaveLength(2);
    expect(calls[0]!.searchParams.get('filter')).toBe('topics.id:T1,publication_year:2023-2025');
  });
});

describe('searchQueries', () => {
  it('rotates templates, then countries', () => {
    const q = searchQueries(0, 3);
    expect(q).toHaveLength(3);
    expect(new Set(q).size).toBe(3);
    expect(searchQueries(3, 1)[0]).not.toBe(q[0]);
  });
});

describe('searchSeeds', () => {
  it('keeps public citation URLs as seeds only, never profile or reference hosts', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'x',
                annotations: [
                  { type: 'url_citation', url_citation: { url: 'https://chem.uni.edu/research/' } },
                  {
                    type: 'url_citation',
                    url_citation: { url: 'https://en.wikipedia.org/wiki/X' },
                  },
                  { type: 'url_citation', url_citation: { url: 'http://10.0.0.1/' } },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const s = await searchSeeds(['q'], {
      apiKey: 'k',
      model: 'm',
      topics: [],
      fetchImpl,
      sleepImpl: async () => {},
    });
    expect(s).toEqual([
      { url: 'https://chem.uni.edu/research/', priority: 6, depth: 0, seedHost: 'chem.uni.edu' },
    ]);
  });
});
