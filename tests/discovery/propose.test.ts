import { describe, expect, it } from 'vitest';
import type { GitHubOptions } from '../../src/lib/discovery/github-client';
import { Proposer, type ProposedBatch } from '../../src/lib/discovery/propose';

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

const REPO = '/repos/acme/compchem-events';
const github = (impl: typeof fetch): GitHubOptions => ({
  token: 'gh-test',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

const batch: ProposedBatch = {
  branch: 'discovery/batch/one',
  files: [
    { path: 'data/groups/a.yaml', content: 'id: a\n' },
    { path: 'data/groups/b.yaml', content: 'id: b\n' },
  ],
  title: 'Batch',
  message: 'Add batch',
  body: 'Body text',
  labels: ['needs-review', 'group'],
};

const branchRef = `GET ${REPO}/git/ref/heads/${batch.branch}`;
const pullsList = `GET ${REPO}/pulls?state=all&head=acme:${batch.branch}`;
const contents = (path: string) => `${REPO}/contents/${path}`;

describe('Proposer.proposeBatch', () => {
  it('creates the branch, writes every file, opens one PR and adds both labels', async () => {
    const { impl, calls } = stubGitHub({
      [`GET ${REPO}`]: { status: 200, body: { default_branch: 'main' } },
      [`GET ${REPO}/git/ref/heads/main`]: { status: 200, body: { object: { sha: 'sha-main' } } },
      [branchRef]: { status: 404 },
      [`POST ${REPO}/git/refs`]: { status: 201, body: {} },
      [`GET ${contents('data/groups/a.yaml')}?ref=${batch.branch}`]: { status: 404 },
      [`GET ${contents('data/groups/b.yaml')}?ref=${batch.branch}`]: { status: 404 },
      [`PUT ${contents('data/groups/a.yaml')}`]: { status: 201, body: {} },
      [`PUT ${contents('data/groups/b.yaml')}`]: { status: 201, body: {} },
      [`POST ${REPO}/pulls`]: { status: 201, body: { number: 7 } },
      [`POST ${REPO}/issues/7/labels`]: { status: 200, body: {} },
    });
    const result = await new Proposer(github(impl)).proposeBatch(batch);
    expect(result).toEqual({ outcome: 'opened', pr: 7 });
    expect(
      calls.filter((c) => c.method === 'PUT').map((c) => c.url.split('/contents/')[1]),
    ).toEqual(['data/groups/a.yaml', 'data/groups/b.yaml']);
    expect(calls.filter((c) => c.url.endsWith('/pulls') && c.method === 'POST')).toHaveLength(1);
    const labels = calls
      .filter((c) => c.url.endsWith('/issues/7/labels'))
      .flatMap((c) => (c.body as { labels: string[] }).labels);
    expect(labels).toEqual(['needs-review', 'group']);
  });

  it('puts the files and updates the body of an open PR without opening a second one', async () => {
    const { impl, calls } = stubGitHub({
      [branchRef]: { status: 200, body: { object: { sha: 'sha-branch' } } },
      [pullsList]: { status: 200, body: [{ number: 5, state: 'open' }] },
      [`GET ${contents('data/groups/a.yaml')}?ref=${batch.branch}`]: { status: 404 },
      [`GET ${contents('data/groups/b.yaml')}?ref=${batch.branch}`]: { status: 404 },
      [`PUT ${contents('data/groups/a.yaml')}`]: { status: 201, body: {} },
      [`PUT ${contents('data/groups/b.yaml')}`]: { status: 201, body: {} },
      [`PATCH ${REPO}/pulls/5`]: { status: 200, body: {} },
      [`POST ${REPO}/issues/5/labels`]: { status: 200, body: {} },
    });
    const result = await new Proposer(github(impl)).proposeBatch(batch);
    expect(result).toEqual({ outcome: 'updated', pr: 5 });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false);
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ body: 'Body text' });
  });

  it('writes nothing to a branch whose PR was closed', async () => {
    const { impl, calls } = stubGitHub({
      [branchRef]: { status: 200, body: { object: { sha: 'sha-branch' } } },
      [pullsList]: { status: 200, body: [{ number: 5, state: 'closed' }] },
    });
    const result = await new Proposer(github(impl)).proposeBatch(batch);
    expect(result).toEqual({ outcome: 'reviewed' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });
});
