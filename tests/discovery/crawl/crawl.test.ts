import { describe, expect, it } from 'vitest';
import { runCrawl, SAVE_EVERY } from '../../../src/lib/discovery/crawl/crawl';
import { emptyCrawlState, enqueue } from '../../../src/lib/discovery/crawl/frontier';
import { emptyState } from '../../../src/lib/discovery/state';

const many = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<a href="/theory/group-${i}/">Theory group ${i} lab</a>`,
  ).join('');
const SITE: Record<string, { status: number; body?: string; url?: string }> = {
  'https://uni.example/': {
    status: 200,
    body: `<html><title>Uni</title><body><a href="http://uni.example/theory/">Theoretical chemistry research groups</a><a href="https://uni.example/news/">News</a><a href="https://elsewhere.example/">Partner</a></body></html>`,
  },
  'https://uni.example/theory/': {
    status: 200,
    body: `<html><title>Research groups</title><body><h1>Theoretical and computational chemistry</h1>${many(8)}<a href="https://smithlab.example/">Smith Lab</a><a href="http://10.0.0.5/">Intranet lab</a></body></html>`,
  },
  'https://uni.example/moved/': {
    status: 200,
    url: 'https://other-uni.example/groups/',
    body: `<html><body>${many(9)}</body></html>`,
  },
  'https://busy.example/': { status: 429 },
  'https://self.example/': {
    status: 200,
    body: '<html><body><a href="#main">Skip to content</a><a href="/">Home</a><a href="/research/groups/">Research groups</a></body></html>',
  },
  'https://self.example/research/groups/': {
    status: 200,
    body: '<html><body><a href="#top">Top</a><a href="/">Home</a><a href="/research/groups/">Research groups</a></body></html>',
  },
  'https://gone.example/': { status: 404 },
  'https://down.example/': { status: 503 },
};
function world() {
  const fetched: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    fetched.push(url);
    const page = SITE[url] ?? { status: 200, body: '<html><body><p>Nothing</p></body></html>' };
    const r = new Response(page.body ?? '', {
      status: page.status,
      headers: { 'content-type': 'text/html' },
    });
    if (page.url) Object.defineProperty(r, 'url', { value: page.url });
    return r;
  }) as typeof fetch;
  const llm = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ kind: 'directory', groups: [0, 8, 9] }) } },
        ],
        usage: { total_tokens: 10 },
      }),
      { status: 200 },
    )) as typeof fetch;
  return { fetched, fetchImpl, llm };
}
const deps = (w: ReturnType<typeof world>, over = {}) => {
  const crawl = emptyCrawlState();
  let saves = 0;
  return {
    crawl,
    saves: () => saves,
    d: {
      crawl,
      fetchState: emptyState(),
      fetch: {
        userAgent: 't',
        fetchImpl: w.fetchImpl,
        minHostIntervalMs: 0,
        sleepImpl: async () => {},
      },
      extract: { apiKey: 'k', model: 'm', topics: [], fetchImpl: w.llm, sleepImpl: async () => {} },
      today: '2026-10-01',
      maxPages: 20,
      maxClassify: 5,
      maxTokens: 1_000_000,
      tokensUsedSoFar: 0,
      save: () => void (saves += 1),
      ...over,
    },
  };
};

describe('runCrawl', () => {
  it('walks from a seed to a directory, upgrades http, and keeps off-site and private links out of the frontier', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [{ url: 'https://uni.example/', priority: 5, depth: 0, seedHost: 'uni.example' }],
      '2026-10-01',
    );
    const r = await runCrawl(x.d);
    expect(w.fetched).toContain('https://uni.example/theory/');
    expect(w.fetched.some((u) => u.includes('elsewhere.example') || u.includes('10.0.0.5'))).toBe(
      false,
    );
    expect(x.crawl.visited['https://uni.example/theory/']?.outcome).toBe('directory');
    // Chosen links 0 (in scope) and 8 (Smith Lab, off-site) become leads; 9 (private host) is a lead the resolver will refuse.
    expect(r.leads.map((l) => l.link)).toEqual([
      'https://uni.example/theory/group-0/',
      'https://smithlab.example/',
      'http://10.0.0.5/',
    ]);
    expect(r.leads[0]).toMatchObject({
      context: 'Research groups',
      origin: 'https://uni.example/theory/',
      fromListing: true,
    });
  });

  it('drops a page that redirected out of scope, unparsed', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [{ url: 'https://uni.example/moved/', priority: 5, depth: 0, seedHost: 'uni.example' }],
      '2026-10-01',
    );
    const r = await runCrawl(x.d);
    expect(x.crawl.visited['https://uni.example/moved/']?.outcome).toBe('skipped');
    expect(r.classified).toBe(0);
    expect(x.crawl.queue).toEqual([]);
  });

  it('pauses a host that answers 429 and keeps the page for a later run', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [
        { url: 'https://busy.example/', priority: 9, depth: 0, seedHost: 'busy.example' },
        { url: 'https://busy.example/b', priority: 8, depth: 0, seedHost: 'busy.example' },
      ],
      '2026-10-01',
    );
    const r = await runCrawl(x.d);
    expect(w.fetched.filter((u) => u.startsWith('https://busy.example'))).toEqual([
      'https://busy.example/',
    ]);
    // Not visited: it goes back on the queue for a later run.
    expect(x.crawl.visited['https://busy.example/']).toBeUndefined();
    expect(x.crawl.queue.find((q) => q.url === 'https://busy.example/')?.retries).toBe(1);
    expect(r.errors[0]).toMatch(/429/);
  });

  it('stops at maxPages and saves every 50 pages and at the end', async () => {
    const w = world();
    const x = deps(w, { maxPages: 120 });
    enqueue(
      x.crawl,
      Array.from({ length: 200 }, (_, i) => ({
        url: `https://h${i}.example/`,
        priority: 1,
        depth: 0,
        seedHost: `h${i}.example`,
      })),
      '2026-10-01',
    );
    const r = await runCrawl(x.d);
    expect(r.pagesFetched).toBe(120);
    expect(x.saves()).toBe(Math.floor(120 / SAVE_EVERY) + 1);
  });

  it('re-queues a directory unvisited when the classify budget is spent, fetching it once', async () => {
    const w = world();
    const x = deps(w, { maxClassify: 0 });
    enqueue(
      x.crawl,
      [{ url: 'https://uni.example/theory/', priority: 5, depth: 0, seedHost: 'uni.example' }],
      '2026-10-01',
    );
    await runCrawl(x.d);
    expect(w.fetched.filter((u) => u === 'https://uni.example/theory/')).toHaveLength(1);
    expect(x.crawl.visited['https://uni.example/theory/']).toBeUndefined();
    expect(x.crawl.queue.some((q) => q.url === 'https://uni.example/theory/')).toBe(true);
  });

  it('fetches each page once even when it links to itself', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [{ url: 'https://self.example/', priority: 5, depth: 0, seedHost: 'self.example' }],
      '2026-10-01',
    );
    await runCrawl(x.d);
    const counts = new Map<string, number>();
    for (const u of w.fetched) counts.set(u, (counts.get(u) ?? 0) + 1);
    expect(counts.get('https://self.example/')).toBe(1);
    expect(counts.get('https://self.example/research/groups/')).toBe(1);
  });

  it('treats a 404 as gone, and retries a 503 on later runs up to three times', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [
        { url: 'https://gone.example/', priority: 5, depth: 0, seedHost: 'gone.example' },
        { url: 'https://down.example/', priority: 5, depth: 0, seedHost: 'down.example' },
      ],
      '2026-10-01',
    );
    await runCrawl(x.d);
    expect(x.crawl.visited['https://gone.example/']?.outcome).toBe('skipped');
    expect(x.crawl.queue).toEqual([
      { url: 'https://down.example/', priority: 5, depth: 0, seedHost: 'down.example', retries: 1 },
    ]);
    await runCrawl(x.d);
    await runCrawl(x.d);
    expect(x.crawl.queue).toEqual([]);
    expect(x.crawl.visited['https://down.example/']?.outcome).toBe('skipped');
  });

  it('keeps the leads it found in the crawl state until they are resolved', async () => {
    const w = world();
    const x = deps(w);
    enqueue(
      x.crawl,
      [{ url: 'https://uni.example/theory/', priority: 5, depth: 0, seedHost: 'uni.example' }],
      '2026-10-01',
    );
    await runCrawl(x.d);
    expect(x.crawl.pendingLeads.map((l) => l.link)).toEqual([
      'https://uni.example/theory/group-0/',
      'https://smithlab.example/',
      'http://10.0.0.5/',
    ]);
  });
});
