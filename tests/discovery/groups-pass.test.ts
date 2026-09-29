import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normaliseGroupName } from '../../src/lib/group-validation';
import { openGroupDrafts, runGroupsPass } from '../../src/lib/discovery/groups-pass';
import type { GroupLead } from '../../src/lib/discovery/parsers/group-listing';
import { type DiscoveryState } from '../../src/lib/discovery/state';
import type { RawGroup } from '../../src/lib/types';

const LISTING = 'https://labinitio.org/explore/aust_comp_chem/';
const COOTE_SITE = 'https://cootelab.com/';
const R = '/repos/acme/compchem-events';

const CECAM: RawGroup = {
  id: 'cecam',
  name: 'CECAM',
  kind: 'network',
  website: 'https://www.cecam.org/',
  topics: ['software-hpc'],
  description: 'A European network for computational science.',
  added: '2026-09-01',
};

const COOTE_YAML = `id: coote-group
name: Coote Group
kind: group
pi: Michelle Coote
website: ${COOTE_SITE}
topics: [electronic-structure]
description: Computational quantum chemistry of radical reactions.
added: '2026-09-28'
`;

const cooteLead: GroupLead = {
  text: 'Michelle Coote',
  link: COOTE_SITE,
  context: 'Flinders University',
  origin: LISTING,
  fromListing: true,
};

type StubResponse = { status: number; body?: unknown };

function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
    calls.push(key);
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const NO_OPEN_PRS = { [`GET ${R}/pulls?state=open&per_page=100`]: { status: 200, body: [] } };

const NEW_PR = {
  [`GET ${R}`]: { status: 200, body: { default_branch: 'main' } },
  [`GET ${R}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 'sha-main' } } },
  [`GET ${R}/git/ref/heads/discovery/group/coote-group`]: { status: 404 },
  [`POST ${R}/git/refs`]: { status: 201, body: {} },
  [`GET ${R}/contents/data/groups/coote-group.yaml?ref=discovery/group/coote-group`]: {
    status: 404,
  },
  [`PUT ${R}/contents/data/groups/coote-group.yaml`]: { status: 201, body: {} },
  [`POST ${R}/pulls`]: { status: 201, body: { number: 50 } },
  [`POST ${R}/issues/50/labels`]: { status: 200, body: {} },
};

const chat = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { total_tokens: 10 },
    }),
    { status: 200 },
  );

/** Page and model stubs: the Coote homepage verifies as a group; nothing else exists. */
function stubWorld() {
  const seen = { llmCalls: 0, plugins: 0 };
  const pageFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url !== COOTE_SITE) return new Response('', { status: 404 });
    return new Response(
      `<html><body><h1>Coote Lab</h1><p>${COOTE_SITE} Computational chemistry.</p></body></html>`,
      {
        status: 200,
      },
    );
  }) as typeof fetch;
  const llm = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen.llmCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      plugins?: unknown;
      response_format?: { json_schema: { name: string } };
    };
    if (body.plugins) {
      seen.plugins += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '' } }], usage: { total_tokens: 1 } }),
        { status: 200 },
      );
    }
    if (body.response_format?.json_schema.name === 'registry_entry') {
      return chat({
        found: true,
        group: {
          name: 'Coote Group',
          kind: 'group',
          pi: 'Michelle Coote',
          parent: 'Flinders University',
          location: { city: 'Adelaide', country: 'AU' },
          topics: ['electronic-structure'],
          description: 'Computational quantum chemistry of radical reactions.',
          confidence: 0.8,
        },
      });
    }
    throw new Error('unexpected LLM request');
  }) as typeof fetch;
  return { seen, pageFetch, llm };
}

let dir: string;
let statePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'groups-pass-'));
  statePath = join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const savedLookups = () =>
  (JSON.parse(readFileSync(statePath, 'utf8')) as DiscoveryState).groupLookups;

function passOptions(
  world: ReturnType<typeof stubWorld>,
  github: typeof fetch,
  over: Partial<Parameters<typeof runGroupsPass>[0]> = {},
): Parameters<typeof runGroupsPass>[0] {
  return {
    leads: [cooteLead],
    existingGroups: [CECAM],
    statePath,
    fetch: {
      userAgent: 'test-agent',
      fetchImpl: world.pageFetch,
      minHostIntervalMs: 0,
      sleepImpl: async () => {},
    },
    extract: {
      apiKey: 'k',
      model: 'm',
      topics: ['electronic-structure', 'software-hpc'],
      fetchImpl: world.llm,
      sleepImpl: async () => {},
    },
    github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: github },
    maxSearches: 20,
    maxPages: 20,
    maxPrs: 20,
    maxTokens: 1_000_000,
    tokensUsedSoFar: 0,
    blockedHosts: new Set(),
    today: '2026-09-29',
    ...over,
  };
}

describe('openGroupDrafts', () => {
  it('reads the files of group and backfill PRs only', async () => {
    const { impl, calls } = stubGitHub({
      [`GET ${R}/pulls?state=open&per_page=100`]: {
        status: 200,
        body: [
          {
            number: 1,
            body: '',
            labels: [],
            head: { ref: 'discovery/group/coote-group', sha: 'a' },
          },
          { number: 2, body: '', labels: [], head: { ref: 'discovery/groups-backfill', sha: 'b' } },
          { number: 3, body: '', labels: [], head: { ref: 'discovery/batch/x', sha: 'c' } },
        ],
      },
      [`GET ${R}/contents/data/groups?ref=discovery/group/coote-group`]: {
        status: 200,
        body: [{ path: 'data/groups/coote-group.yaml', type: 'file' }],
      },
      [`GET ${R}/contents/data/groups/coote-group.yaml?ref=discovery/group/coote-group`]: {
        status: 200,
        body: { content: Buffer.from(COOTE_YAML).toString('base64') },
      },
      [`GET ${R}/contents/data/groups?ref=discovery/groups-backfill`]: {
        status: 200,
        body: [{ path: 'data/groups/notes.yaml', type: 'file' }],
      },
      [`GET ${R}/contents/data/groups/notes.yaml?ref=discovery/groups-backfill`]: {
        status: 200,
        body: { content: Buffer.from('- not\n- an object\n').toString('base64') },
      },
    });
    const drafts = await openGroupDrafts({
      token: 't',
      repo: 'acme/compchem-events',
      fetchImpl: impl,
    });
    expect(drafts.map((d) => d.id)).toEqual(['coote-group']);
    expect(calls.some((c) => c.includes('discovery/batch/x'))).toBe(false);
  });
});

describe('runGroupsPass', () => {
  it('opens one group PR for a lead that verifies and records its lookup', async () => {
    const world = stubWorld();
    const { impl, calls } = stubGitHub({ ...NO_OPEN_PRS, ...NEW_PR });
    const result = await runGroupsPass(passOptions(world, impl));
    expect(result.errors).toEqual([]);
    expect(result.prsOpened).toBe(1);
    expect(calls).toContain(`POST ${R}/pulls`);
    expect(Object.entries(savedLookups()).map(([k, l]) => [k, l.outcome])).toEqual([
      [normaliseGroupName('Michelle Coote'), 'drafted'],
    ]);
  });

  it('makes no search for a name already in an open group PR', async () => {
    const world = stubWorld();
    const { impl } = stubGitHub({
      [`GET ${R}/pulls?state=open&per_page=100`]: {
        status: 200,
        body: [
          {
            number: 1,
            body: '',
            labels: [],
            head: { ref: 'discovery/group/coote-group', sha: 'a' },
          },
        ],
      },
      [`GET ${R}/contents/data/groups?ref=discovery/group/coote-group`]: {
        status: 200,
        body: [{ path: 'data/groups/coote-group.yaml', type: 'file' }],
      },
      [`GET ${R}/contents/data/groups/coote-group.yaml?ref=discovery/group/coote-group`]: {
        status: 200,
        body: { content: Buffer.from(COOTE_YAML).toString('base64') },
      },
    });
    const result = await runGroupsPass(passOptions(world, impl));
    expect(result).toMatchObject({ prsOpened: 0, searches: 0, errors: [] });
    expect(world.seen.llmCalls).toBe(0);
  });

  it('does not cache a name whose PR was cut off by MAX_PRS', async () => {
    const world = stubWorld();
    const { impl } = stubGitHub({ ...NO_OPEN_PRS });
    const result = await runGroupsPass(passOptions(world, impl, { maxPrs: 0 }));
    expect(result.prsOpened).toBe(0);
    expect(result.skipped).toEqual([{ id: 'coote-group', reason: 'MAX_PRS reached' }]);
    expect(savedLookups()).toEqual({});
  });

  it('does not cache a name whose PR failed on a GitHub error', async () => {
    const world = stubWorld();
    const { impl } = stubGitHub({
      ...NO_OPEN_PRS,
      ...NEW_PR,
      [`PUT ${R}/contents/data/groups/coote-group.yaml`]: { status: 500 },
    });
    const result = await runGroupsPass(passOptions(world, impl));
    expect(result.prsOpened).toBe(0);
    expect(result.errors.map((e) => e.source)).toEqual(['coote-group']);
    expect(savedLookups()).toEqual({});
  });

  it('returns a GitHub listing failure in errors and resolves', async () => {
    const world = stubWorld();
    const { impl } = stubGitHub({ [`GET ${R}/pulls?state=open&per_page=100`]: { status: 500 } });
    const result = await runGroupsPass(passOptions(world, impl));
    expect(result.prsOpened).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('failed to list open pull requests');
    expect(world.seen.llmCalls).toBe(0);
  });
});
