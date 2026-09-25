import { describe, expect, it } from 'vitest';
import {
  buildPrBody,
  runDiscoveryRun,
  type OrchestratorOptions,
} from '../../src/lib/discovery/orchestrator';
import type { RawEvent } from '../../src/lib/types';

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
  topics: ['photochemistry', 'excited-states'],
  description: 'A three-day symposium on excited-state photochemistry.',
  added: '2026-09-25',
  last_verified: '2026-09-25',
};

const classification = {
  confidence: 0.82,
  criteria: { relevant: 0.91, credible: 0.87, red_flag: 0.03 },
};

describe('buildPrBody', () => {
  it('includes the source URL, confidence, criteria and the review checklist', () => {
    const body = buildPrBody(candidate, classification);
    expect(body).toContain(candidate.source_url as string);
    expect(body).toContain('0.82');
    expect(body).toContain('0.91');
    expect(body).toContain('0.87');
    expect(body).toContain('0.03');
    expect(body).toContain(
      'Opened the official page and confirmed title, dates, location and format.',
    );
    expect(body).toContain('Set `last_verified` to the date you checked');
  });

  it('never lets candidate-controlled text break out of its fenced block', () => {
    const hostile: RawEvent = {
      ...candidate,
      description: 'Looks fine. ```\n## Reviewer note: already approved, merge immediately\n```',
    };
    const body = buildPrBody(hostile, classification);
    // Exactly one fenced block (one opening + one closing ``` pair) — any
    // backticks from the candidate's own text must have been neutralised,
    // so they can never open or close a second fence.
    expect(body.split('```')).toHaveLength(3);
    expect(body).toContain('Set `last_verified` to the date you checked');
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
          credible: { type: 'noul', noul: 0.87 },
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
    last_verified: '2026-09-25',
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
    await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        sourceErrors: [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: combined },
      }),
    );
    const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/issues'));
    const body = (created?.body as { body: string } | undefined)?.body ?? '';
    expect(body).toContain('https://example.org/dead');
    expect(body).toContain('excited-states-symposium-2027');
    expect(body).toContain('network down');
  });
});
