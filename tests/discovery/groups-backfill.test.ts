import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBackfillPrBody,
  parseBackfillArgs,
  runBackfill,
  type BackfillDeps,
} from '../../scripts/discovery/groups-backfill';
import { normaliseGroupName } from '../../src/lib/group-validation';
import type { DiscoveryState } from '../../src/lib/discovery/state';
import type { GroupCandidate } from '../../src/lib/discovery/groups';
import type { Source } from '../../src/lib/discovery/sources';

const R = '/repos/acme/compchem-events';
const BRANCH = 'discovery/groups-backfill';
const LISTING = 'https://labinitio.org/explore/aust_comp_chem/';
const COOTE = 'https://cootelab.com/';
const SMITH = 'https://smithlab.org/';
const COOTE_MIRROR = 'https://www.cootelab.com/';

const SOURCES: Source[] = [{ name: 'Lab Initio', url: LISTING, kind: 'group-listing' }];

const LISTING_HTML = `<html><body><main><h2>Australia</h2>
<a href="${COOTE}">Michelle Coote</a>
<a href="${SMITH}">Jane Smith</a>
<a href="${COOTE_MIRROR}">Coote Lab mirror</a>
</main></body></html>`;

const chat = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { total_tokens: 10 },
    }),
    { status: 200 },
  );

function stubWorld() {
  const pageFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url === LISTING) return new Response(LISTING_HTML, { status: 200 });
    const owner = url.includes('cootelab') ? 'Coote' : url.includes('smithlab') ? 'Smith' : '';
    if (!owner) return new Response('', { status: 404 });
    return new Response(`<html><body><h1>${owner} Lab</h1><p>${url} Chemistry.</p></body></html>`, {
      status: 200,
    });
  }) as typeof fetch;
  const llm = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: unknown;
      response_format?: { json_schema: { name: string } };
    };
    if (body.response_format?.json_schema.name !== 'registry_entry') {
      throw new Error('unexpected LLM request');
    }
    const smith = JSON.stringify(body.messages).includes('Smith');
    return chat({
      found: true,
      group: {
        name: smith ? 'Smith Group' : 'Coote Group',
        kind: 'group',
        pi: smith ? 'Jane Smith' : 'Michelle Coote',
        parent: 'Some University',
        location: { city: 'Adelaide', country: 'AU' },
        topics: ['electronic-structure'],
        description: 'Computational quantum chemistry of radical reactions.',
        confidence: 0.8,
      },
    });
  }) as typeof fetch;
  return { pageFetch, llm };
}

type StubResponse = { status: number; body?: unknown };

function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls, keys: () => calls.map((c) => c.key) };
}

const FILES = ['coote-group', 'smith-group'];
const fileStubs = (status: number, ids = FILES): Record<string, StubResponse> =>
  Object.fromEntries(
    ids.flatMap((id) => [
      [`GET ${R}/contents/data/groups/${id}.yaml?ref=${BRANCH}`, { status: 404 }],
      [`PUT ${R}/contents/data/groups/${id}.yaml`, { status, body: {} }],
    ]),
  );

const BRANCH_DIR = `GET ${R}/contents/data/groups?ref=${BRANCH}`;
const OPEN_LIST = `GET ${R}/pulls?state=open&per_page=100`;
const NEW_BATCH: Record<string, StubResponse> = {
  [OPEN_LIST]: { status: 200, body: [] },
  [`GET ${R}`]: { status: 200, body: { default_branch: 'main' } },
  [`GET ${R}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 'sha-main' } } },
  [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 404 },
  [BRANCH_DIR]: { status: 404 },
  [`POST ${R}/git/refs`]: { status: 201, body: {} },
  ...fileStubs(201),
  [`POST ${R}/pulls`]: { status: 201, body: { number: 60 } },
  [`POST ${R}/issues/60/labels`]: { status: 200, body: {} },
};

const OPEN_BATCH_LIST = {
  status: 200,
  body: [{ number: 60, body: '', labels: [], head: { ref: BRANCH, sha: 'a' } }],
};
const EXISTING_BRANCH: Record<string, StubResponse> = {
  [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 200, body: { object: { sha: 'sha-b' } } },
  [`GET ${R}/pulls?state=all&head=acme:${BRANCH}`]: {
    status: 200,
    body: [{ number: 60, state: 'open' }],
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'groups-backfill-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function deps(github: typeof fetch): BackfillDeps {
  const world = stubWorld();
  return {
    github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: github },
    extract: {
      apiKey: 'k',
      model: 'm',
      topics: ['electronic-structure', 'software-hpc'],
      fetchImpl: world.llm,
      sleepImpl: async () => {},
    },
    fetch: {
      userAgent: 'test-agent',
      fetchImpl: world.pageFetch,
      minHostIntervalMs: 0,
      sleepImpl: async () => {},
    },
    statePath: join(dir, 'state.json'),
    today: '2026-09-29',
    maxSearches: 20,
    maxPages: 20,
    maxTokens: 1_000_000,
    blockedHosts: new Set(),
    events: [],
    positions: [],
    groups: [],
    sources: SOURCES,
  };
}

describe('parseBackfillArgs', () => {
  it('reads the three caps', () => {
    expect(parseBackfillArgs(['--max-searches', '50'])).toEqual({ maxSearches: 50 });
    expect(parseBackfillArgs(['--max-pages', '9', '--max-tokens', '1000'])).toEqual({
      maxPages: 9,
      maxTokens: 1000,
    });
    expect(parseBackfillArgs([])).toEqual({});
  });

  it('rejects non-positive values, missing values and unknown flags', () => {
    expect(() => parseBackfillArgs(['--max-searches', '0'])).toThrow(/positive integer/);
    expect(() => parseBackfillArgs(['--max-pages', '-3'])).toThrow(/positive integer/);
    expect(() => parseBackfillArgs(['--max-pages'])).toThrow(/positive integer/);
    expect(() => parseBackfillArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});

describe('buildBackfillPrBody', () => {
  const candidate = (name: string): GroupCandidate => ({
    draft: {
      id: 'x-group',
      name,
      kind: 'group',
      website: 'https://x.org/',
      topics: ['electronic-structure'],
      description: 'd',
      added: '2026-09-29',
    },
    confidence: 0.8,
    lead: { text: 'X | lead', origin: LISTING, fromListing: true },
    lookupKey: 'x',
    considered: [],
  });

  it('keeps a hostile name in one cell and has no Confidence line', () => {
    const body = buildBackfillPrBody(
      [candidate('Evil | `injected`\n| cell')],
      [{ name: 'Old | Lab', reason: 'duplicate-name' }],
    );
    expect(body).not.toMatch(/Confidence:/i);
    const row = body.split('\n').find((l) => l.includes('x-group'))!;
    expect(row.split(/(?<!\\)\|/)).toHaveLength(8);
    expect(body).toContain('Skipped (1):');
    expect(body).toContain('- `Old \\| Lab`: duplicate-name');
  });
});

describe('buildBackfillPrBody earlier files', () => {
  it('lists files an earlier run wrote that this run did not find again', () => {
    const body = buildBackfillPrBody([], [], ['data/groups/gone-group.yaml']);
    expect(body).toContain('not found again this time (1)');
    expect(body).toContain('- `data/groups/gone-group.yaml`');
    expect(buildBackfillPrBody([], [])).not.toContain('not found again');
  });
});

describe('buildBackfillPrBody size', () => {
  it('lists at most 100 skipped names and clips a long organiser string', () => {
    const skipped = Array.from({ length: 300 }, (_, i) => ({
      name: `Name ${i}`,
      reason: 'duplicate-name',
    }));
    const long: GroupCandidate = {
      draft: {
        id: 'x-group',
        name: 'X Group',
        kind: 'group',
        website: 'https://x.org/',
        topics: ['electronic-structure'],
        description: 'd',
        added: '2026-09-29',
      },
      confidence: 0.8,
      lead: { text: 'Organiser '.repeat(50), origin: LISTING, fromListing: false },
      lookupKey: 'x',
      considered: [],
    };
    const body = buildBackfillPrBody([long], skipped);
    expect(body.split('\n').filter((l) => l.startsWith('- `Name '))).toHaveLength(100);
    expect(body).toContain('…and 200 more skipped (see the run log)');
    const row = body.split('\n').find((l) => l.includes('x-group'))!;
    expect(row).toContain('…');
    expect(row.length).toBeLessThan(300);
  });
});

describe('runBackfill', () => {
  it('writes every accepted draft to one branch and one PR, listing the duplicate as skipped', async () => {
    const gh = stubGitHub(NEW_BATCH);
    const result = await runBackfill(deps(gh.impl));
    expect(result).toEqual({ proposal: { outcome: 'opened', pr: 60 }, accepted: 2, skipped: 1 });
    expect(gh.keys().filter((k) => k.startsWith('PUT '))).toEqual(
      FILES.map((id) => `PUT ${R}/contents/data/groups/${id}.yaml`),
    );
    expect(gh.keys().filter((k) => k === `POST ${R}/pulls`)).toHaveLength(1);
    const pr = gh.calls.find((c) => c.key === `POST ${R}/pulls`)!.body as {
      head: string;
      body: string;
    };
    expect(pr.head).toBe(BRANCH);
    expect(pr.body).not.toMatch(/Confidence:/i);
    expect(pr.body).toContain('`coote-group`');
    expect(pr.body).toContain('`smith-group`');
    expect(pr.body.split('Skipped (1):')[1]).toContain('duplicate');
  });

  it('updates the same PR on a re-run and does not skip its own earlier files', async () => {
    const first = stubGitHub(NEW_BATCH);
    await runBackfill(deps(first.impl));
    const written = first.calls.filter((c) => c.key.startsWith('PUT '));
    const gh = stubGitHub({
      [OPEN_LIST]: OPEN_BATCH_LIST,
      // The batch's own files are read once, to forget their cache entries.
      [BRANCH_DIR]: {
        status: 200,
        body: FILES.map((id) => ({ path: `data/groups/${id}.yaml`, type: 'file' })),
      },
      ...Object.fromEntries(
        written.map((c) => [
          `GET ${R}/contents/data/groups/${c.key.split('/').pop()}?ref=${BRANCH}`,
          {
            status: 200,
            body: { content: (c.body as { content: string }).content, sha: 's' },
          },
        ]),
      ),
      ...EXISTING_BRANCH,
      [`PATCH ${R}/pulls/60`]: { status: 200, body: {} },
      [`POST ${R}/issues/60/labels`]: { status: 200, body: {} },
    });
    const result = await runBackfill(deps(gh.impl));
    // The mirror was skipped as a duplicate last time and stays cached, so it is not re-listed.
    expect(result).toEqual({ proposal: { outcome: 'updated', pr: 60 }, accepted: 2, skipped: 0 });
    expect(gh.keys().some((k) => k === `POST ${R}/pulls`)).toBe(false);
    // Unchanged files are not written again.
    expect(gh.keys().filter((k) => k.startsWith('PUT '))).toHaveLength(0);
  });

  it('leaves a name cached as drafted elsewhere skipped, and keeps its cache entry', async () => {
    const d = deps(stubGitHub({}).impl);
    const key = normaliseGroupName('Jane Smith');
    const entry = { triedAt: new Date().toISOString(), outcome: 'drafted' };
    writeFileSync(
      d.statePath,
      JSON.stringify({ hosts: {}, pages: {}, groupLookups: { [key]: entry } }),
    );
    const gh = stubGitHub({ ...NEW_BATCH, ...fileStubs(201, ['coote-group']) });
    const result = await runBackfill({ ...d, github: { ...d.github, fetchImpl: gh.impl } });
    expect(result).toMatchObject({ proposal: { outcome: 'opened' }, accepted: 1 });
    expect(gh.keys().filter((k) => k.startsWith('PUT '))).toEqual([
      `PUT ${R}/contents/data/groups/coote-group.yaml`,
    ]);
    const saved = JSON.parse(readFileSync(d.statePath, 'utf8')) as DiscoveryState;
    expect(saved.groupLookups[key]).toEqual(entry);
  });

  it('writes nothing and searches nothing when the batch PR was already closed', async () => {
    const gh = stubGitHub({
      [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 200, body: { object: { sha: 'sha-b' } } },
      [`GET ${R}/pulls?state=all&head=acme:${BRANCH}`]: {
        status: 200,
        body: [{ number: 60, state: 'closed' }],
      },
    });
    const d = deps(gh.impl);
    let pagesFetched = 0;
    const pageFetch = d.fetch.fetchImpl!;
    d.fetch = {
      ...d.fetch,
      fetchImpl: ((...a) => (pagesFetched++, pageFetch(...a))) as typeof fetch,
    };
    const result = await runBackfill(d);
    expect(result).toEqual({ proposal: { outcome: 'reviewed' }, accepted: 0, skipped: 0 });
    expect(pagesFetched).toBe(0);
    expect(gh.keys().some((k) => k.startsWith('PUT ') || k.startsWith('POST '))).toBe(false);
  });
});
