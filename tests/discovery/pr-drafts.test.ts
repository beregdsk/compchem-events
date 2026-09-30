import { describe, expect, it } from 'vitest';
import { discoveryPrDrafts } from '../../src/lib/discovery/pr-drafts';
import { emptyState } from '../../src/lib/discovery/state';

const R = '/repos/acme/compchem-events';
const b64 = (text: string) => ({ content: Buffer.from(text, 'utf8').toString('base64') });

function stubGitHub(responses: Record<string, { status: number; body?: unknown }>) {
  const keys: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace('https://api.github.com', '')}`;
    keys.push(key);
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(JSON.stringify(stub.body ?? {}), { status: stub.status });
  }) as typeof fetch;
  return { github: { token: 't', repo: 'acme/compchem-events', fetchImpl: impl }, keys };
}

const EVENT_YAML = 'title: Some Workshop\nstart_date: 2026-10-21\nurl: https://a.org/w\n';
const POSITION_YAML = 'title: PhD\ninstitution: Uni\nurl: https://t.me/c/1\n';

const WORLD = {
  [`GET ${R}/pulls?state=open&per_page=100`]: {
    status: 200,
    body: [
      { number: 85, body: '', labels: [], head: { ref: 'discovery/some-workshop', sha: 's85' } },
      { number: 90, body: '', labels: [], head: { ref: 'discovery/group/x', sha: 's90' } },
      { number: 91, body: '', labels: [], head: { ref: 'fix/by-hand', sha: 's91' } },
    ],
  },
  [`GET ${R}/pulls/85/files?per_page=100`]: {
    status: 200,
    body: [{ filename: 'data/events/2026/some-workshop-2026.yaml', status: 'added' }],
  },
  [`GET ${R}/contents/data/events/2026/some-workshop-2026.yaml?ref=s85`]: {
    status: 200,
    body: b64(EVENT_YAML),
  },
  [`GET ${R}/pulls?state=closed&per_page=100&page=1`]: {
    status: 200,
    body: [
      { number: 108, merged_at: null, head: { ref: 'discovery/position/phd-2026', sha: 's108' } },
      { number: 110, merged_at: '2026-09-29T00:00:00Z', head: { ref: 'discovery/y', sha: 's110' } },
      { number: 7, merged_at: null, head: { ref: 'docs/manual', sha: 's7' } },
    ],
  },
  [`GET ${R}/pulls/108/files?per_page=100`]: {
    status: 200,
    body: [
      { filename: 'data/positions/2026/phd-2026.yaml', status: 'added' },
      { filename: 'README.md', status: 'modified' },
    ],
  },
  [`GET ${R}/contents/data/positions/2026/phd-2026.yaml?ref=s108`]: {
    status: 200,
    body: b64(POSITION_YAML),
  },
};

describe('discoveryPrDrafts', () => {
  it('reads open and rejected discovery PRs, skipping group, merged and human PRs', async () => {
    const { github } = stubGitHub(WORLD);
    const drafts = await discoveryPrDrafts(github, emptyState());
    expect(drafts.events).toEqual([
      {
        entry: { title: 'Some Workshop', start_date: '2026-10-21', url: 'https://a.org/w' },
        where: '#85 (open)',
        branch: 'discovery/some-workshop',
      },
    ]);
    // A rejected PR carries no branch, so it blocks its own id as well.
    expect(drafts.positions).toEqual([
      {
        entry: { title: 'PhD', institution: 'Uni', url: 'https://t.me/c/1' },
        where: '#108 (closed without merging)',
        branch: undefined,
      },
    ]);
  });

  it('reads a rejected PR once and serves it from the state after that', async () => {
    const state = emptyState();
    await discoveryPrDrafts(stubGitHub(WORLD).github, state);
    expect(Object.keys(state.rejectedPrs)).toEqual(['108']);
    const second = stubGitHub(WORLD);
    const drafts = await discoveryPrDrafts(second.github, state);
    expect(second.keys.some((k) => k.includes('/pulls/108/'))).toBe(false);
    expect(drafts.positions).toHaveLength(1);
  });
});
