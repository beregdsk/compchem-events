import { describe, expect, it } from 'vitest';
import {
  buildPrBody,
  buildGroupPrBody,
  groupSkipReason,
  proposeGroups,
  runDiscoveryRun,
  type OrchestratorOptions,
} from '../../src/lib/discovery/orchestrator';
import type { GroupCandidate } from '../../src/lib/discovery/groups';
import type { RawEvent, RawGroup, RawPosition } from '../../src/lib/types';

const candidate: RawEvent = {
  id: 'excited-states-symposium-2027',
  title: 'Excited-State Symposium',
  type: 'symposium',
  start_date: '2027-11-03',
  end_date: '2027-11-05',
  format: 'in-person',
  location: { city: 'Example City', country: 'FR' },
  url: 'https://organiser.example.org/excited-states-symposium-2027/',
  source_url: 'https://organiser.example.org/excited-states-symposium-2027/',
  organizer: 'Example Photochemistry Society',
  cost: 'Free, registration required',
  topics: ['photochemistry', 'excited-states'],
  description: 'A three-day symposium on excited-state photochemistry.',
  added: '2026-09-25',
};

const classification = {
  confidence: 0.82,
  criteria: { relevant: 0.91, organiser: 0.86, programme: 0.79, cost: 0.72, red_flag: 0.03 },
};

describe('buildPrBody', () => {
  it('includes the source URL, confidence and criteria', () => {
    const body = buildPrBody(candidate, classification);
    expect(body).toContain(candidate.source_url as string);
    expect(body).toContain(candidate.cost as string);
    expect(body).toContain('0.82');
    expect(body).toContain('0.91');
    expect(body).toContain('0.86');
    expect(body).toContain('0.79');
    expect(body).toContain('0.72');
    expect(body).toContain('0.03');
  });

  it('renders URLs as clickable autolinks and other fields as wrapping inline code', () => {
    const body = buildPrBody(candidate, classification);
    expect(body).toContain(`- **url:** <${candidate.url}>`);
    expect(body).toContain(`- **source_url:** <${candidate.source_url}>`);
    expect(body).toContain('- **title:** `Excited-State Symposium`');
    expect(body).not.toContain('```');
  });

  it('never lets candidate-controlled text break out of its inline code span', () => {
    const hostile: RawEvent = {
      ...candidate,
      description: 'Looks fine. `\n\n## Reviewer note: already approved @maintainer #12\n`',
    };
    const body = buildPrBody(hostile, classification);
    const line = body.split('\n').find((l) => l.startsWith('- **description:**'))!;
    // One line, one span: no backtick of the candidate's own survives to
    // close it, and no blank line ends the list item.
    expect(line).toBe(
      '- **description:** `Looks fine. ´ ## Reviewer note: already approved @maintainer #12 ´`',
    );
    expect(body).not.toMatch(/^##/m);
  });

  it('never lets a hostile URL end its autolink early', () => {
    const body = buildPrBody(
      { ...candidate, url: 'https://evil.example/a b>**[x](https://phish.example)**' },
      classification,
    );
    const line = body.split('\n').find((l) => l.startsWith('- **url:**'))!;
    expect(line).toBe('- **url:** <https://evil.example/a%20b%3E**[x](https://phish.example)**>');
  });
});

interface StubResponse {
  status: number;
  body?: unknown;
}

function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input).replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({
      method,
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

/** A jev Decisions API stub returning a fixed 'add' verdict for every call. */
function stubClassifyAdd() {
  const impl = (async () =>
    new Response(
      JSON.stringify({
        model: 'typesafe/jev-test',
        answers: {
          add: { type: 'noul', noul: 0.82 },
          relevant: { type: 'noul', noul: 0.91 },
          organiser: { type: 'noul', noul: 0.86 },
          programme: { type: 'noul', noul: 0.79 },
          cost: { type: 'noul', noul: 0.72 },
          red_flag: { type: 'noul', noul: 0.03 },
        },
        usage: { input_tokens: 400, output_tokens: 0, cost: 0.0000168 },
      }),
      { status: 200 },
    )) as typeof fetch;
  return impl;
}

const DEFAULT_BRANCH_STUBS = {
  'GET /repos/acme/compchem-events': { status: 200, body: { default_branch: 'main' } },
  'GET /repos/acme/compchem-events/git/ref/heads/main': {
    status: 200,
    body: { object: { sha: 'sha-main' } },
  },
};

function baseOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    candidates: [],
    existingEvents: [],
    blockedHosts: new Set(),
    classify: { apiKey: 'sk-test', fetchImpl: stubClassifyAdd() },
    github: { token: 'gh-test', repo: 'acme/compchem-events' },
    sourceErrors: [],
    maxPrs: 20,
    maxTokens: 500_000,
    tokensUsedSoFar: 0,
    positions: [],
    existingPositions: [],
    log: () => {},
    ...overrides,
  };
}

function candidateEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'excited-states-symposium-2027',
    title: 'Excited-State Symposium',
    type: 'symposium',
    start_date: '2027-11-03',
    end_date: '2027-11-05',
    format: 'online',
    url: 'https://organiser.example.org/excited-states-symposium-2027/',
    source_url: 'https://organiser.example.org/excited-states-symposium-2027/',
    topics: ['photochemistry'],
    description: 'A symposium on excited-state photochemistry.',
    added: '2026-09-25',
    ...overrides,
  };
}

describe('runDiscoveryRun', () => {
  it('opens a new PR for a brand-new candidate', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 404,
      },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 201, body: {} },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 11 } },
      'POST /repos/acme/compchem-events/issues/11/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );

    expect(result.prsOpened).toBe(1);
    expect(result.prsUpdated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.tokensUsed).toBe(400);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/labels'))).toBe(true);
  });

  // Regression test for a real duplicate that reached main: two sources in
  // the same run described the same event (same url), and both got their
  // own PR — mechanicalSkip's dedupe only ever saw existingEvents as it
  // stood at the start of the run, never the run's own prior candidates.
  it('skips a same-run duplicate of an earlier candidate this run already accepted', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 404,
      },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 201, body: {} },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 11 } },
      'POST /repos/acme/compchem-events/issues/11/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const first = candidateEvent();
    // A different id/title, same url — exactly PRs #16 and #21's shape.
    const second = candidateEvent({
      id: 'excited-state-symposium-full-title-2027',
      title: 'The Excited-State Symposium, Full Title With Dates',
    });

    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [first, second],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );

    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([
      { id: 'excited-state-symposium-full-title-2027', reason: 'duplicate-url' },
    ]);
    // Only one PR ever opened — the second candidate never reached GitHub at all.
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toHaveLength(1);
  });

  it('updates the existing open PR when the branch already has one', async () => {
    const { impl } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/excited-states-symposium-2027':
        { status: 200, body: [{ number: 5, state: 'open' }] },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 200, body: { sha: 'file-sha' } },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 200, body: {} },
      'PATCH /repos/acme/compchem-events/pulls/5': { status: 200, body: {} },
      'POST /repos/acme/compchem-events/issues/5/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );

    expect(result.prsOpened).toBe(0);
    expect(result.prsUpdated).toBe(1);
  });

  it('skips a candidate whose branch has a closed or merged PR (already reviewed)', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/excited-states-symposium-2027':
        { status: 200, body: [{ number: 5, state: 'closed' }] },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );

    expect(result.prsOpened).toBe(0);
    expect(result.prsUpdated).toBe(0);
    expect(result.skipped).toEqual([
      { id: 'excited-states-symposium-2027', reason: 'already reviewed' },
    ]);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  // C1 from the final review: a prior run can crash after createBranch but
  // before openPr (rate limit, network error, process killed). The branch
  // then exists with no PR at all — everHadPr: false — which must resume,
  // not be mistaken for "a human already closed/merged this".
  it('resumes an orphaned branch that was created but never got a PR opened', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/excited-states-symposium-2027':
        { status: 200, body: [] },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 201, body: {} },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 12 } },
      'POST /repos/acme/compchem-events/issues/12/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );

    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/git/refs'))).toBe(false);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true);
  });

  it('skips a mechanically-duplicate candidate without any GitHub branch calls', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const existing = candidateEvent();
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        existingEvents: [existing],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([
      { id: 'excited-states-symposium-2027', reason: 'duplicate-url' },
    ]);
    expect(calls.some((c) => c.url.includes('/git/refs') || c.url.includes('/pulls'))).toBe(false);
  });

  it('stops opening PRs once MAX_PRS is reached, logging the rest as skipped', async () => {
    const { impl } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/first-2027': { status: 404 },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/first-2027.yaml?ref=discovery/first-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/first-2027.yaml': {
        status: 201,
        body: {},
      },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 1 } },
      'POST /repos/acme/compchem-events/issues/1/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [
          candidateEvent({
            id: 'first-2027',
            title: 'First Event',
            url: 'https://example.org/first',
          }),
          candidateEvent({
            id: 'second-2027',
            title: 'Second Event',
            url: 'https://example.org/second',
          }),
        ],
        maxPrs: 1,
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([{ id: 'second-2027', reason: 'MAX_PRS reached' }]);
    expect(result.deferred).toEqual(['second-2027']);
  });

  it('stops classifying once MAX_TOKENS is reached, logging the rest as skipped', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        maxTokens: 100,
        tokensUsedSoFar: 100,
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([
      { id: 'excited-states-symposium-2027', reason: 'MAX_TOKENS reached' },
    ]);
    expect(result.deferred).toEqual(['excited-states-symposium-2027']);
    expect(result.tokensUsed).toBe(100);
  });

  it('isolates one candidate erroring from the rest of the run', async () => {
    // Only the first candidate's branch calls fail; everything the second
    // candidate needs is stubbed normally, so a real PR can be asserted for
    // it — proving the run actually continues, not just that it doesn't
    // throw.
    const { impl: workingImpl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/second-2027': { status: 404 },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/second-2027.yaml?ref=discovery/second-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/second-2027.yaml': {
        status: 201,
        body: {},
      },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 21 } },
      'POST /repos/acme/compchem-events/issues/21/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
      'POST /repos/acme/compchem-events/issues': { status: 201, body: { number: 30 } },
    });
    const combined: typeof fetch = (input, init) => {
      const url = String(input);
      if (url.includes('discovery/first-2027')) throw new Error('network down');
      return workingImpl(input, init);
    };
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [
          candidateEvent({
            id: 'first-2027',
            title: 'First Event',
            url: 'https://example.org/first',
          }),
          candidateEvent({
            id: 'second-2027',
            title: 'Second Event',
            url: 'https://example.org/second',
          }),
        ],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: combined },
      }),
    );
    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([
      { id: 'first-2027', reason: expect.stringContaining('network down') },
    ]);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true);
  });

  it('makes no branch or PR calls and still syncs the failure issue when there are zero candidates', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 3, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/3': { status: 200, body: {} },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [],
        sourceErrors: [],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(0);
    expect(calls).toHaveLength(2); // list + close, nothing else
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
  });

  // I1 from the final review: a candidate that errors out (GitHub call
  // failure, classification failure) is otherwise only ever logged to
  // stderr of a cron job nobody reads — the tracking issue is the one
  // place a human would actually see it.
  it('surfaces a per-candidate error in the failure-tracking issue alongside source errors', async () => {
    const failingImpl: typeof fetch = async () => {
      throw new Error('network down');
    };
    const { impl: issueImpl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
      'POST /repos/acme/compchem-events/issues': { status: 201, body: { number: 9 } },
    });
    const combined: typeof fetch = (input, init) => {
      const url = String(input);
      return url.includes('/issues') ? issueImpl(input, init) : failingImpl(input, init);
    };
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        sourceErrors: [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: combined },
      }),
    );
    // Only the orchestrator's own errors are returned; source errors are the caller's.
    expect(result.errors).toEqual([
      { source: 'excited-states-symposium-2027', message: 'network down' },
    ]);
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'));
    const body = (created?.body as { body: string } | undefined)?.body ?? '';
    expect(body).toContain('https://example.org/dead');
    expect(body).toContain('excited-states-symposium-2027');
    expect(body).toContain('network down');
  });
});

describe('runDiscoveryRun positions', () => {
  const position = (over: Partial<RawPosition> = {}): RawPosition => ({
    id: 'utrecht-university-phd-position-in-molecular-dynamics-2026',
    title: 'PhD position in molecular dynamics',
    level: 'phd',
    institution: 'Utrecht University',
    location: { city: 'Utrecht', country: 'NL' },
    url: 'https://example.org/jobs/phd-md',
    source_url: 'https://example.org/jobs.xml',
    topics: ['molecular-dynamics'],
    description: 'A funded PhD project.',
    added: '2026-09-29',
    ...over,
  });
  const branchPath = (id: string) => `discovery/position/${id}`;
  const newPrStubs = (id: string, pr: number) => ({
    ...DEFAULT_BRANCH_STUBS,
    [`GET /repos/acme/compchem-events/git/ref/heads/${branchPath(id)}`]: { status: 404 },
    [`GET /repos/acme/compchem-events/git/ref/heads/${branchPath(id.replace(/2026$/, '2025'))}`]: {
      status: 404,
    },
    'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
    [`GET /repos/acme/compchem-events/contents/data/positions/2026/${id}.yaml?ref=${branchPath(id)}`]:
      { status: 404 },
    [`PUT /repos/acme/compchem-events/contents/data/positions/2026/${id}.yaml`]: {
      status: 201,
      body: {},
    },
    'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: pr } },
    [`POST /repos/acme/compchem-events/issues/${pr}/labels`]: { status: 200, body: {} },
    'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
      status: 200,
      body: [],
    },
  });

  it('opens a labelled PR for a new position, with the confidence line first', async () => {
    const p = position();
    const { impl, calls } = stubGitHub(newPrStubs(p.id, 30));
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: p, confidence: 0.85 }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(1);
    const labels = calls
      .filter((c) => c.url.endsWith('/issues/30/labels'))
      .flatMap((c) => (c.body as { labels: string[] }).labels);
    expect(labels).toEqual(['needs-review', 'position']);
    const pr = calls.find((c) => c.url.endsWith('/pulls'))!.body as { body: string; head: string };
    expect(pr.head).toBe(branchPath(p.id));
    expect(pr.body.split('\n')[0]).toBe('Confidence: 0.85');
  });

  it('skips a position below the confidence floor without calling GitHub', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: position(), confidence: 0.3 }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: position().id, reason: 'low confidence' }]);
    expect(calls.some((c) => c.url.endsWith('/pulls'))).toBe(false);
  });

  it('skips a position already on main by url', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: position({ id: 'other-2026', title: 'Renamed' }), confidence: 0.9 }],
        existingPositions: [position()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: 'other-2026', reason: 'duplicate-url' }]);
  });

  // Review focus 1: two mailbox adverts with no advert link share the fallback url.
  it('does not treat a shared fallback url as a duplicate', async () => {
    const fallback = 'https://example.org/list-info';
    const a = position({ url: fallback, source_url: fallback });
    const b = position({
      id: 'eth-zurich-postdoc-in-dft-2026',
      title: 'Postdoc in DFT',
      institution: 'ETH Zurich',
      url: fallback,
      source_url: fallback,
    });
    const { impl } = stubGitHub({ ...newPrStubs(a.id, 31), ...newPrStubs(b.id, 31) });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [
          { draft: a, confidence: 0.9 },
          { draft: b, confidence: 0.9 },
        ],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(2);
    expect(result.skipped).toEqual([]);
  });

  it('skips a same-run duplicate by title and institution', async () => {
    const first = position();
    const second = position({ id: 'dup-2026', url: 'https://example.org/jobs/other' });
    const { impl } = stubGitHub(newPrStubs(first.id, 32));
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [
          { draft: first, confidence: 0.9 },
          { draft: second, confidence: 0.9 },
        ],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: 'dup-2026', reason: 'duplicate-title-institution' }]);
  });

  it('skips a blocklisted advert host', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: position(), confidence: 0.9 }],
        blockedHosts: new Set(['example.org']),
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: position().id, reason: 'blocklisted' }]);
  });

  // Re-sighting an advert whose PR is still open must not rewrite it: the
  // file's `added` date is when the advert was first seen.
  it('leaves an already open position PR untouched', async () => {
    const p = position({ added: '2026-10-20' });
    const failureIssue = {
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    };
    const { impl, calls } = stubGitHub({
      ...failureIssue,
      [`GET /repos/acme/compchem-events/git/ref/heads/${branchPath(p.id.replace(/2026$/, '2025'))}`]:
        { status: 404 },
      [`GET /repos/acme/compchem-events/git/ref/heads/${branchPath(p.id)}`]: {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      [`GET /repos/acme/compchem-events/pulls?state=all&head=acme:${branchPath(p.id)}`]: {
        status: 200,
        body: [{ number: 40, state: 'open' }],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: p, confidence: 0.9 }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: p.id, reason: 'already proposed' }]);
    expect(result.prsUpdated).toBe(0);
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'PATCH')).toBe(false);
  });

  it('skips an advert first proposed under the previous year id', async () => {
    const p = position();
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
      [`GET /repos/acme/compchem-events/git/ref/heads/${branchPath(p.id.replace(/2026$/, '2025'))}`]:
        { status: 200, body: { object: { sha: 'sha-old' } } },
      [`GET /repos/acme/compchem-events/pulls?state=all&head=acme:${branchPath(p.id.replace(/2026$/, '2025'))}`]:
        { status: 200, body: [{ number: 12, state: 'closed' }] },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        positions: [{ draft: p, confidence: 0.9 }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: p.id, reason: 'already proposed' }]);
    expect(calls.some((c) => c.url.endsWith('/pulls'))).toBe(false);
  });

  it('defers positions once MAX_PRS is used up', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        maxPrs: 0,
        positions: [{ draft: position(), confidence: 0.9 }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.deferred).toEqual([position().id]);
  });
});

describe('runDiscoveryRun accepted', () => {
  it('returns the candidates judged add, even when MAX_PRS stops their PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const c = candidateEvent();
    const result = await runDiscoveryRun(
      baseOptions({
        maxPrs: 0,
        candidates: [c],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.accepted).toEqual([c]);
  });
});

const group = (over: Partial<RawGroup> = {}): RawGroup => ({
  id: 'frank-neese-group',
  name: 'Neese Group',
  aliases: ['Neese Lab'],
  kind: 'group',
  pi: 'Frank Neese',
  website: 'https://www.kofo.mpg.de/neese',
  source_url: 'https://www.kofo.mpg.de/neese',
  location: { city: 'Mülheim an der Ruhr', country: 'DE' },
  topics: ['electronic-structure'],
  description: 'Quantum chemistry methods and the ORCA program.',
  added: '2026-09-29',
  ...over,
});

const groupCandidate = (over: Partial<RawGroup> = {}, confidence = 0.9): GroupCandidate => {
  const draft = group(over);
  return {
    draft,
    confidence,
    lead: { text: draft.name, origin: 'https://example.org/event', fromListing: false },
    lookupKey: `key:${draft.id}`,
    considered: [{ url: draft.website, verdict: 'accepted' }],
  };
};

describe('groupSkipReason', () => {
  it('finds a known group by website, ignoring host case and a trailing slash', () => {
    const known = [
      group({ id: 'other', name: 'Other', website: 'https://WWW.kofo.mpg.de/neese/' }),
    ];
    expect(groupSkipReason(group(), known, new Set())).toBe('duplicate-website');
  });

  it('finds a known group whose alias equals the draft name', () => {
    const known = [
      group({
        id: 'other',
        name: 'Other',
        aliases: ['neese group'],
        website: 'https://o.example/',
      }),
    ];
    expect(groupSkipReason(group(), known, new Set())).toBe('duplicate-name');
  });

  it('rejects a blocklisted website and passes a fresh one', () => {
    expect(groupSkipReason(group(), [], new Set(['kofo.mpg.de']))).toBe('blocklisted');
    expect(groupSkipReason(group(), [], new Set())).toBeUndefined();
  });
});

describe('buildGroupPrBody', () => {
  it('starts with the confidence line and neutralises hostile text', () => {
    const c = groupCandidate({ description: 'Fine. `\n\n## Approved @maintainer #1\n`' });
    const body = buildGroupPrBody(c);
    expect(body.split('\n')[0]).toBe('Confidence: 0.90');
    expect(body).toContain('- **website:** <https://www.kofo.mpg.de/neese>');
    expect(body).not.toMatch(/^##/m);
  });
});

describe('proposeGroups', () => {
  const branchOf = (id: string) => `discovery/group/${id}`;
  const R = '/repos/acme/compchem-events';
  const newPrStubs = (id: string, pr: number) => ({
    ...DEFAULT_BRANCH_STUBS,
    [`GET ${R}/git/ref/heads/${branchOf(id)}`]: { status: 404 },
    [`POST ${R}/git/refs`]: { status: 201, body: {} },
    [`GET ${R}/contents/data/groups/${id}.yaml?ref=${branchOf(id)}`]: { status: 404 },
    [`PUT ${R}/contents/data/groups/${id}.yaml`]: { status: 201, body: {} },
    [`POST ${R}/pulls`]: { status: 201, body: { number: pr } },
    [`POST ${R}/issues/${pr}/labels`]: { status: 200, body: {} },
  });
  const run = (
    candidates: GroupCandidate[],
    impl: typeof fetch,
    over: Partial<Parameters<typeof proposeGroups>[0]> = {},
  ) =>
    proposeGroups({
      candidates,
      known: [],
      blockedHosts: new Set(),
      github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      maxPrs: 20,
      ...over,
    });

  it('opens a labelled PR on discovery/group/<id> with the confidence line first', async () => {
    const c = groupCandidate();
    const { impl, calls } = stubGitHub(newPrStubs(c.draft.id, 40));
    const result = await run([c], impl);
    expect(result).toEqual({ prsOpened: 1, skipped: [], deferredKeys: [], errors: [] });
    const pr = calls.find((x) => x.url.endsWith('/pulls'))!.body as {
      body: string;
      head: string;
      title: string;
    };
    expect(pr.head).toBe(branchOf(c.draft.id));
    expect(pr.title).toBe('Group: Neese Group');
    expect(pr.body.split('\n')[0]).toBe('Confidence: 0.90');
    const labels = calls
      .filter((x) => x.url.endsWith('/issues/40/labels'))
      .flatMap((x) => (x.body as { labels: string[] }).labels);
    expect(labels).toEqual(['needs-review', 'group']);
  });

  it('skips low confidence, duplicates and blocklisted hosts without calling GitHub', async () => {
    const { impl, calls } = stubGitHub({});
    const known = [
      group({
        id: 'known-one',
        name: 'Known',
        aliases: ['Old Name'],
        website: 'https://Known.example/lab/',
      }),
    ];
    const result = await run(
      [
        groupCandidate({ id: 'low' }, 0.3),
        groupCandidate({
          id: 'dup-site',
          name: 'Dup Site',
          aliases: [],
          website: 'https://known.example/lab',
        }),
        groupCandidate({
          id: 'dup-name',
          name: 'old name',
          aliases: [],
          website: 'https://fresh.example/',
        }),
        groupCandidate({
          id: 'blocked',
          name: 'Blocked',
          aliases: [],
          website: 'https://bad.example/x',
        }),
      ],
      impl,
      { known, blockedHosts: new Set(['bad.example']) },
    );
    expect(result.skipped).toEqual([
      { id: 'low', reason: 'low confidence' },
      { id: 'dup-site', reason: 'duplicate-website' },
      { id: 'dup-name', reason: 'duplicate-name' },
      { id: 'blocked', reason: 'blocklisted' },
    ]);
    expect(calls).toEqual([]);
  });

  it('opens one PR for two drafts that resolved to the same website', async () => {
    const a = groupCandidate({ id: 'group-a', name: 'Group A', aliases: [] });
    const b = groupCandidate({
      id: 'group-b',
      name: 'Group B',
      aliases: [],
      website: 'https://WWW.kofo.mpg.de/neese/',
    });
    const { impl } = stubGitHub(newPrStubs('group-a', 41));
    const result = await run([a, b], impl);
    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([{ id: 'group-b', reason: 'duplicate-website' }]);
  });

  it('leaves an open PR alone and does not reopen a reviewed one', async () => {
    const open = groupCandidate({
      id: 'open-one',
      name: 'Open One',
      aliases: [],
      website: 'https://a.example/',
    });
    const closed = groupCandidate({
      id: 'closed-one',
      name: 'Closed One',
      aliases: [],
      website: 'https://b.example/',
    });
    const { impl, calls } = stubGitHub({
      [`GET ${R}/git/ref/heads/${branchOf('open-one')}`]: { status: 200, body: {} },
      [`GET ${R}/pulls?state=all&head=acme:${branchOf('open-one')}`]: {
        status: 200,
        body: [{ number: 3, state: 'open' }],
      },
      [`GET ${R}/git/ref/heads/${branchOf('closed-one')}`]: { status: 200, body: {} },
      [`GET ${R}/pulls?state=all&head=acme:${branchOf('closed-one')}`]: {
        status: 200,
        body: [{ number: 4, state: 'closed' }],
      },
    });
    const result = await run([open, closed], impl);
    expect(result.prsOpened).toBe(0);
    expect(result.skipped).toEqual([
      { id: 'open-one', reason: 'already proposed' },
      { id: 'closed-one', reason: 'already reviewed' },
    ]);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('defers a good candidate once MAX_PRS is used up, returning its lookup key', async () => {
    const a = groupCandidate({
      id: 'group-a',
      name: 'Group A',
      aliases: [],
      website: 'https://a.example/',
    });
    const b = groupCandidate({
      id: 'group-b',
      name: 'Group B',
      aliases: [],
      website: 'https://b.example/',
    });
    const { impl } = stubGitHub(newPrStubs('group-a', 42));
    const result = await run([a, b], impl, { maxPrs: 1 });
    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([{ id: 'group-b', reason: 'MAX_PRS reached' }]);
    expect(result.deferredKeys).toEqual([b.lookupKey]);
  });

  it('records a GitHub failure and still proposes the next candidate', async () => {
    const a = groupCandidate({
      id: 'group-a',
      name: 'Group A',
      aliases: [],
      website: 'https://a.example/',
    });
    const b = groupCandidate({
      id: 'group-b',
      name: 'Group B',
      aliases: [],
      website: 'https://b.example/',
    });
    const { impl } = stubGitHub({
      ...newPrStubs('group-b', 43),
      [`GET ${R}/git/ref/heads/${branchOf('group-a')}`]: { status: 500 },
    });
    const result = await run([a, b], impl);
    expect(result.prsOpened).toBe(1);
    expect(result.errors).toEqual([{ source: 'group-a', message: expect.stringContaining('500') }]);
    expect(result.skipped).toEqual([{ id: 'group-a', reason: expect.stringMatching(/^error:/) }]);
  });
});
