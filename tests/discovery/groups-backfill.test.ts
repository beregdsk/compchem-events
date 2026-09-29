import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBackfillPrBody,
  parseBackfillArgs,
  runBackfill,
  type BackfillDeps,
} from '../../scripts/discovery/groups-backfill';
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
const fileStubs = (status: number): Record<string, StubResponse> =>
  Object.fromEntries(
    FILES.flatMap((id) => [
      [`GET ${R}/contents/data/groups/${id}.yaml?ref=${BRANCH}`, { status: 404 }],
      [`PUT ${R}/contents/data/groups/${id}.yaml`, { status, body: {} }],
    ]),
  );

const OPEN_LIST = `GET ${R}/pulls?state=open&per_page=100`;
const NEW_BATCH: Record<string, StubResponse> = {
  [OPEN_LIST]: { status: 200, body: [] },
  [`GET ${R}`]: { status: 200, body: { default_branch: 'main' } },
  [`GET ${R}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 'sha-main' } } },
  [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 404 },
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
    await runBackfill(deps(stubGitHub(NEW_BATCH).impl));
    const gh = stubGitHub({
      [OPEN_LIST]: OPEN_BATCH_LIST,
      // The backfill branch's own files are never listed: no contents stub for them.
      ...EXISTING_BRANCH,
      ...fileStubs(200),
      [`PATCH ${R}/pulls/60`]: { status: 200, body: {} },
      [`POST ${R}/issues/60/labels`]: { status: 200, body: {} },
    });
    const result = await runBackfill(deps(gh.impl));
    expect(result).toEqual({ proposal: { outcome: 'updated', pr: 60 }, accepted: 2, skipped: 1 });
    expect(gh.keys().some((k) => k === `POST ${R}/pulls`)).toBe(false);
    expect(gh.keys().filter((k) => k.startsWith('PUT '))).toHaveLength(2);
  });

  it('writes nothing when the batch PR was already closed', async () => {
    const gh = stubGitHub({
      [OPEN_LIST]: { status: 200, body: [] },
      [`GET ${R}/git/ref/heads/${BRANCH}`]: { status: 200, body: { object: { sha: 'sha-b' } } },
      [`GET ${R}/pulls?state=all&head=acme:${BRANCH}`]: {
        status: 200,
        body: [{ number: 60, state: 'closed' }],
      },
    });
    const result = await runBackfill(deps(gh.impl));
    expect(result).toEqual({ proposal: { outcome: 'reviewed' }, accepted: 0, skipped: 1 });
    expect(gh.keys().some((k) => k.startsWith('PUT ') || k.startsWith('POST '))).toBe(false);
  });
});
