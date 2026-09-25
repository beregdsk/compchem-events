import { describe, expect, it } from 'vitest';
import {
  addLabel,
  createBranch,
  getBranchStatus,
  getDefaultBranch,
  openPr,
  putFile,
  syncFailureIssue,
  updatePrBody,
  type GitHubOptions,
} from '../../src/lib/discovery/github-client';

interface StubResponse {
  status: number;
  body?: unknown;
}

/** Keyed by "METHOD path", where path is everything after the GitHub API host. */
function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const path = url.replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const options = (impl: typeof fetch): GitHubOptions => ({
  token: 'gh-test-token',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

describe('getDefaultBranch', () => {
  it('resolves the default branch name and its current sha', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events': { status: 200, body: { default_branch: 'main' } },
      'GET /repos/acme/compchem-events/git/ref/heads/main': {
        status: 200,
        body: { object: { sha: 'abc123' } },
      },
    });
    const result = await getDefaultBranch(options(impl));
    expect(result).toEqual({ name: 'main', sha: 'abc123' });
  });
});

describe('getBranchStatus', () => {
  it('reports a branch that does not exist', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 404,
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: false });
  });

  it('reports a branch that exists with an open PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [{ number: 42 }],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: 42 });
  });

  it('reports a branch that exists with no open PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: undefined });
  });
});

describe('createBranch', () => {
  it('creates a ref from the given sha', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
    });
    await createBranch('discovery/some-event-2027', 'abc123', options(impl));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.github.com/repos/acme/compchem-events/git/refs',
        body: { ref: 'refs/heads/discovery/some-event-2027', sha: 'abc123' },
      },
    ]);
  });

  it('throws on a non-201 response', async () => {
    const { impl } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 422, body: { message: 'exists' } },
    });
    await expect(createBranch('discovery/some-event-2027', 'abc123', options(impl))).rejects.toThrow(
      'HTTP 422',
    );
  });
});

describe('putFile', () => {
  it('creates a new file when none exists on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml':
        { status: 201, body: {} },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Add candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      message: 'Add candidate event: Some Event',
      content: Buffer.from('title: Some Event\n', 'utf8').toString('base64'),
      branch: 'discovery/some-event-2027',
    });
  });

  it('includes the existing sha when updating a file already on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 200, body: { sha: 'file-sha-1' } },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml':
        { status: 200, body: {} },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Update candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ sha: 'file-sha-1' });
  });
});

describe('openPr, updatePrBody, addLabel', () => {
  it('opens a pull request and returns its number', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 7 } },
    });
    const result = await openPr(
      'discovery/some-event-2027',
      'main',
      'Some Event',
      'PR body',
      options(impl),
    );
    expect(result).toEqual({ number: 7 });
    expect(calls[0]?.body).toEqual({
      title: 'Some Event',
      head: 'discovery/some-event-2027',
      base: 'main',
      body: 'PR body',
    });
  });

  it('updates a pull request body', async () => {
    const { impl, calls } = stubGitHub({
      'PATCH /repos/acme/compchem-events/pulls/7': { status: 200, body: {} },
    });
    await updatePrBody(7, 'new body', options(impl));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { body: 'new body' } });
  });

  it('adds a label to a pull request', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/issues/7/labels': { status: 200, body: {} },
    });
    await addLabel(7, 'needs-review', options(impl));
    expect(calls[0]?.body).toEqual({ labels: ['needs-review'] });
  });
});
