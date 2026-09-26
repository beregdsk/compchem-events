import { describe, expect, it } from 'vitest';
import {
  autoApproveHighConfidencePrs,
  parseConfidence,
  AUTO_APPROVE_THRESHOLD,
  HIGH_CONFIDENCE_LABEL,
} from '../../src/lib/discovery/auto-approve';
import { buildPrBody } from '../../src/lib/discovery/orchestrator';
import type { RawEvent } from '../../src/lib/types';

const candidate: RawEvent = {
  id: 'excited-states-symposium-2027',
  title: 'Excited-State Symposium',
  type: 'symposium',
  start_date: '2027-11-03',
  end_date: '2027-11-05',
  format: 'in-person',
  url: 'https://organiser.example.org/excited-states-symposium-2027/',
  topics: ['photochemistry'],
  description: 'A symposium on excited-state photochemistry.',
  added: '2026-09-25',
  last_verified: '2026-09-25',
};

function bodyWithConfidence(confidence: number): string {
  return buildPrBody(candidate, {
    confidence,
    criteria: { relevant: 0.9, organiser: 0.9, programme: 0.9, cost: 0.9, red_flag: 0.02 },
  });
}

describe('parseConfidence', () => {
  it("reads the number from buildPrBody's own Confidence line", () => {
    expect(parseConfidence(bodyWithConfidence(0.93))).toBe(0.93);
  });

  it('returns undefined for a body with no Confidence line', () => {
    expect(parseConfidence('A hand-written PR with no confidence line at all.')).toBeUndefined();
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

const githubOptions = (impl: typeof fetch) => ({
  token: 'gh-test-token',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

const greenChecks = {
  check_runs: [
    { name: 'check', status: 'completed', conclusion: 'success' },
    { name: 'e2e', status: 'completed', conclusion: 'success' },
    { name: 'Workers Builds: compchem-events', status: 'completed', conclusion: 'failure' },
  ],
};

describe('autoApproveHighConfidencePrs', () => {
  it('approves and labels a PR at or above the threshold once required checks are green', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(AUTO_APPROVE_THRESHOLD),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [{ name: 'needs-review' }],
          },
        ],
      },
      'GET /repos/acme/compchem-events/commits/sha-5/check-runs?per_page=100': {
        status: 200,
        body: greenChecks,
      },
      'POST /repos/acme/compchem-events/pulls/5/reviews': { status: 200, body: {} },
      'POST /repos/acme/compchem-events/issues/5/labels': { status: 200, body: {} },
    });
    const result = await autoApproveHighConfidencePrs(githubOptions(impl));
    expect(result).toEqual({ approved: [5], skipped: [] });
    const review = calls.find((c) => c.url.endsWith('/pulls/5/reviews'));
    // 'COMMENT', never 'APPROVE' — GitHub rejects an actor formally
    // approving its own PR, and this token opened every discovery PR.
    expect(review?.body).toMatchObject({ event: 'COMMENT' });
    const label = calls.find((c) => c.url.endsWith('/issues/5/labels'));
    expect(label?.body).toEqual({ labels: [HIGH_CONFIDENCE_LABEL] });
  });

  it('skips a PR below the confidence threshold, without checking its CI status', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.89),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
    });
    const result = await autoApproveHighConfidencePrs(githubOptions(impl));
    expect(result.approved).toEqual([]);
    expect(result.skipped).toEqual([{ number: 5, reason: 'confidence 0.89 below threshold' }]);
    // Never spent a call checking CI for a PR that was never going to qualify anyway.
    expect(calls).toHaveLength(1);
  });

  it('skips a high-confidence PR whose required checks have not all passed', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.95),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
      'GET /repos/acme/compchem-events/commits/sha-5/check-runs?per_page=100': {
        status: 200,
        body: {
          check_runs: [
            { name: 'check', status: 'completed', conclusion: 'failure' },
            { name: 'e2e', status: 'completed', conclusion: 'success' },
          ],
        },
      },
    });
    const result = await autoApproveHighConfidencePrs(githubOptions(impl));
    expect(result.approved).toEqual([]);
    expect(result.skipped).toEqual([{ number: 5, reason: 'checks not green: check' }]);
  });

  it('never re-approves a PR that already carries the high-confidence label', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.95),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [{ name: HIGH_CONFIDENCE_LABEL }],
          },
        ],
      },
    });
    const result = await autoApproveHighConfidencePrs(githubOptions(impl));
    expect(result.skipped).toEqual([{ number: 5, reason: 'already flagged' }]);
    expect(calls).toHaveLength(1);
  });

  it('skips a PR whose body has no parseable confidence line', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: 'A hand-edited PR body with the Confidence line removed.',
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
    });
    const result = await autoApproveHighConfidencePrs(githubOptions(impl));
    expect(result.skipped).toEqual([
      { number: 5, reason: 'could not parse confidence from PR body' },
    ]);
  });
});
