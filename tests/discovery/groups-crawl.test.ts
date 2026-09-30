import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acquireLock,
  parseCrawlArgs,
  releaseLock,
  runGroupsCrawl,
  type GroupsCrawlDeps,
} from '../../scripts/discovery/groups-crawl';

describe('parseCrawlArgs', () => {
  it('reads the caps and the model, with defaults', () => {
    expect(parseCrawlArgs([])).toEqual({
      maxPages: 200,
      maxClassify: 40,
      maxSearches: 5,
      maxPrs: 1,
    });
    expect(parseCrawlArgs(['--max-pages', '20000', '--model', 'x/y'])).toMatchObject({
      maxPages: 20000,
      model: 'x/y',
    });
    expect(() => parseCrawlArgs(['--max-pages', '0'])).toThrow(/positive integer/);
    expect(() => parseCrawlArgs(['--nope'])).toThrow(/unknown argument/);
  });
});

describe('lock', () => {
  it('refuses while a live process holds it and takes over a dead one', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'lock-')), 'crawl.lock');
    expect(acquireLock(path)).toBe(true);
    expect(acquireLock(path)).toBe(false);
    releaseLock(path);
    expect(existsSync(path)).toBe(false);
    writeFileSync(path, '999999999');
    expect(acquireLock(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(String(process.pid));
  });
});

const R = '/repos/acme/compchem-events';
function github(responses: Record<string, { status: number; body?: unknown }>) {
  const keys: string[] = [];
  const bodies: Record<string, unknown> = {};
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
    keys.push(key);
    if (init?.body) bodies[key] = JSON.parse(String(init.body));
    const s =
      responses[key] ??
      (key.startsWith('GET ') && key.includes('/contents/') ? { status: 404 } : undefined);
    if (!s) throw new Error(`unstubbed: ${key}`);
    return new Response(JSON.stringify(s.body ?? {}), { status: s.status });
  }) as typeof fetch;
  return { keys, bodies, gh: { token: 't', repo: 'acme/compchem-events', fetchImpl } };
}

const PAGES: Record<string, string> = {
  'https://uni.example/': `<html><title>Uni</title><body><h1>Theoretical and computational chemistry research groups</h1>
    <a href="https://coote.example/">Coote Lab</a><a href="https://smith.example/">Smith Lab</a>
    <a href="https://coote.example/">Coote Lab again</a></body></html>`,
  'https://coote.example/':
    '<html><body><h1>Coote Lab</h1><p>https://coote.example/ Radical chemistry.</p></body></html>',
  'https://smith.example/':
    '<html><body><h1>Smith Lab</h1><p>https://smith.example/ Molecular dynamics.</p></body></html>',
  'https://dept.example/groups/': `<html><title>Groups</title><body><h1>Theoretical and computational chemistry research groups</h1>
    <a href="/groups/jones/">Jones Lab</a><a href="/groups/smith/">Smith Lab</a></body></html>`,
  'https://dept.example/groups/jones/':
    '<html><body><h1>Jones Lab</h1><p>https://dept.example/groups/jones/ Quantum chemistry.</p></body></html>',
  'https://dept.example/groups/smith/':
    '<html><body><h1>Smith Lab</h1><p>https://dept.example/groups/smith/ Molecular dynamics.</p></body></html>',
};

function deps(
  dir: string,
  gh: GroupsCrawlDeps['github'],
  over: Partial<GroupsCrawlDeps> = {},
): GroupsCrawlDeps {
  const pageFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return PAGES[url]
      ? new Response(PAGES[url], { status: 200 })
      : new Response('', { status: 404 });
  }) as typeof fetch;
  const llm = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema: { name: string } };
      messages: Array<{ content: string }>;
    };
    const name = body.response_format?.json_schema.name;
    const reply =
      name === 'crawl_page'
        ? { kind: 'directory', groups: [0, 1] }
        : {
            found: true,
            group: {
              name: body.messages[1]!.content.includes('Smith') ? 'Smith Lab' : 'Coote Lab',
              kind: 'group',
              pi: null,
              parent: 'Uni',
              location: { city: 'Adelaide', country: 'AU' },
              topics: ['electronic-structure'],
              description: 'Computational chemistry.',
              confidence: 0.9,
            },
          };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(reply) } }],
        usage: { total_tokens: 5 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return {
    github: gh,
    extract: {
      apiKey: 'k',
      model: 'm',
      topics: ['electronic-structure'],
      fetchImpl: llm,
      sleepImpl: async () => {},
    },
    fetch: {
      userAgent: 't',
      fetchImpl: pageFetch,
      minHostIntervalMs: 0,
      sleepImpl: async () => {},
    },
    statePath: join(dir, 'state.json'),
    crawlStatePath: join(dir, 'crawl-state.json'),
    lockPath: join(dir, 'crawl.lock'),
    today: '2026-10-01',
    args: { maxPages: 20, maxClassify: 5, maxSearches: 0, maxPrs: 1 },
    maxTokens: 1_000_000,
    blockedHosts: new Set(),
    topics: [],
    groups: [],
    positions: [],
    sources: [{ name: 'Uni', url: 'https://uni.example/', kind: 'group-listing' } as never],
    ...over,
  };
}

const NEW_BRANCH = (branch: string) => ({
  [`GET ${R}/pulls?state=open&per_page=100`]: { status: 200, body: [] },
  [`GET ${R}/git/ref/heads/${branch}`]: { status: 404 },
  [`GET ${R}`]: { status: 200, body: { default_branch: 'main' } },
  [`GET ${R}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 's' } } },
  [`POST ${R}/git/refs`]: { status: 201 },
  [`PUT ${R}/contents/data/groups/coote-lab.yaml`]: { status: 201 },
  [`PUT ${R}/contents/data/groups/smith-lab.yaml`]: { status: 201 },
  [`POST ${R}/pulls`]: { status: 201, body: { number: 200 } },
  [`POST ${R}/issues/200/labels`]: { status: 200 },
});

describe('runGroupsCrawl', () => {
  it('crawls a listing seed, verifies each group once, and proposes one batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const g = github(NEW_BRANCH('discovery/groups-crawl/2026-10-01-1'));
    const r = await runGroupsCrawl(deps(dir, g.gh));
    expect(r).toMatchObject({ status: 'done', accepted: 2, prs: [200] });
    expect(g.keys.filter((k) => k.startsWith('PUT '))).toHaveLength(2);
    const pr = g.bodies[`POST ${R}/pulls`] as { head: string; body: string };
    expect(pr.head).toBe('discovery/groups-crawl/2026-10-01-1');
    expect(pr.body).not.toMatch(/Confidence:/);
    expect(pr.body).toContain('found by the groups crawler');
    expect(existsSync(join(dir, 'crawl-state.json'))).toBe(true);
    expect(existsSync(join(dir, 'crawl.lock'))).toBe(false);
  });

  it('skips a group already in an open crawl or backfill PR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const coote =
      'id: coote-lab\nname: Coote Lab\nkind: group\nwebsite: https://coote.example/\ntopics: [electronic-structure]\ndescription: d\nadded: 2026-09-30\nlocation: { city: Adelaide, country: AU }\n';
    const g = github({
      ...NEW_BRANCH('discovery/groups-crawl/2026-10-01-1'),
      [`GET ${R}/pulls?state=open&per_page=100`]: {
        status: 200,
        body: [
          {
            number: 113,
            body: '',
            labels: [],
            head: { ref: 'discovery/groups-crawl/2026-09-30-1', sha: 'a' },
          },
        ],
      },
      [`GET ${R}/contents/data/groups?ref=discovery/groups-crawl/2026-09-30-1`]: {
        status: 200,
        body: [{ path: 'data/groups/coote-lab.yaml', type: 'file' }],
      },
      [`GET ${R}/contents/data/groups/coote-lab.yaml?ref=discovery/groups-crawl/2026-09-30-1`]: {
        status: 200,
        body: { content: Buffer.from(coote).toString('base64') },
      },
    });
    const r = await runGroupsCrawl(deps(dir, g.gh));
    expect(r.accepted).toBe(1);
    expect(g.keys.filter((k) => k.startsWith('PUT '))).toEqual([
      `PUT ${R}/contents/data/groups/smith-lab.yaml`,
    ]);
  });

  it('does nothing while another crawl holds the lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    writeFileSync(join(dir, 'crawl.lock'), String(process.pid));
    const g = github({});
    const r = await runGroupsCrawl(deps(dir, g.gh));
    expect(r.status).toBe('locked');
    expect(g.keys).toEqual([]);
    expect(existsSync(join(dir, 'crawl-state.json'))).toBe(false);
  });

  it('proposes groups whose pages are on the same site as their directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const g = github(NEW_BRANCH('discovery/groups-crawl/2026-10-01-1'));
    const r = await runGroupsCrawl(
      deps(dir, g.gh, {
        sources: [
          { name: 'Dept', url: 'https://dept.example/groups/', kind: 'group-listing' } as never,
        ],
      }),
    );
    expect(r.accepted).toBe(2);
  });

  it('resumes leads a killed run found but never proposed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const crawl = {
      version: 1,
      queue: [],
      visited: {},
      searchCountryIndex: 0,
      pendingLeads: [
        {
          text: 'Smith Lab',
          link: 'https://smith.example/',
          origin: 'https://uni.example/',
          fromListing: true,
          crawled: true,
        },
      ],
    };
    writeFileSync(join(dir, 'crawl-state.json'), JSON.stringify(crawl));
    const g = github(NEW_BRANCH('discovery/groups-crawl/2026-10-01-1'));
    const r = await runGroupsCrawl(deps(dir, g.gh, { sources: [] }));
    expect(r.accepted).toBe(1);
    expect(g.keys.filter((k) => k.startsWith('PUT '))).toEqual([
      `PUT ${R}/contents/data/groups/smith-lab.yaml`,
    ]);
    expect(JSON.parse(readFileSync(join(dir, 'crawl-state.json'), 'utf8')).pendingLeads).toEqual(
      [],
    );
  });

  it('writes only its lookups into the shared state file, keeping what another process wrote meanwhile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const statePath = join(dir, 'state.json');
    const other = { triedAt: '2026-09-30T00:00:00.000Z', outcome: 'not found' };
    writeFileSync(
      statePath,
      JSON.stringify({
        hosts: {},
        pages: { 'https://x/': { fetchedAt: 'a' } },
        groupLookups: { theirs: other },
      }),
    );
    const d = deps(dir, github(NEW_BRANCH('discovery/groups-crawl/2026-10-01-1')).gh);
    const fetchImpl = d.fetch.fetchImpl!;
    d.fetch = {
      ...d.fetch,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === 'https://smith.example/') {
          // The nightly run saves its state while the crawl is verifying.
          const s = JSON.parse(readFileSync(statePath, 'utf8'));
          s.groupLookups.mid = other;
          writeFileSync(statePath, JSON.stringify(s));
        }
        return fetchImpl(input, init);
      }) as typeof fetch,
    };
    await runGroupsCrawl(d);
    const s = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(Object.keys(s.groupLookups).sort()).toEqual([
      'link:https://coote.example/',
      'link:https://smith.example/',
      'mid',
      'theirs',
    ]);
    expect(Object.keys(s.pages)).toEqual(['https://x/']);
  });

  it('never reuses a batch branch that already exists today', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gc-'));
    const first = 'discovery/groups-crawl/2026-10-01-1';
    const g = github({
      ...NEW_BRANCH('discovery/groups-crawl/2026-10-01-2'),
      [`GET ${R}/git/ref/heads/${first}`]: { status: 200, body: { object: { sha: 'x' } } },
      [`GET ${R}/pulls?state=all&head=acme:${first}`]: {
        status: 200,
        body: [{ number: 150, state: 'open' }],
      },
    });
    await runGroupsCrawl(deps(dir, g.gh));
    const pr = g.bodies[`POST ${R}/pulls`] as { head: string };
    expect(pr.head).toBe('discovery/groups-crawl/2026-10-01-2');
    expect(g.keys.some((k) => k.startsWith('PATCH '))).toBe(false);
  });
});
