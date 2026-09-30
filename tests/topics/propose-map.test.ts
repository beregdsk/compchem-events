import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  buildMapPrBody,
  classifyTopics,
  fetchCandidates,
} from '../../src/lib/topics/propose-map';
import type { CandidateTopic } from '../../src/lib/topics/map-rules';

const YAML = `# Controlled vocabulary.
# Keep this comment.
- slug: dft
  label: Density functional theory
- slug: catalysis
  label: Catalysis
  openalex: [T9]
`;

describe('applyMapping', () => {
  it('writes flow lists in place, keeps comments and order, and removes emptied lists', () => {
    const out = applyMapping(
      YAML,
      new Map([
        ['dft', ['T2', 'T1']],
        ['catalysis', []],
      ]),
    );
    expect(out).toBe(`# Controlled vocabulary.
# Keep this comment.
- slug: dft
  label: Density functional theory
  openalex: [ T1, T2 ]
- slug: catalysis
  label: Catalysis
`);
  });
});

const cand = (id: string, name: string): CandidateTopic => ({
  id,
  name,
  description: '',
  keywords: [],
  subfield: 's',
  works: 10,
});

describe('classifyTopics', () => {
  it('keeps only ids from the batch and slugs from the vocabulary, and sends topics as data with no tools', async () => {
    let body:
      { tools?: unknown; plugins?: unknown; messages: Array<{ content: string }> } | undefined;
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const content = JSON.stringify({
        assignments: [
          { id: 'T1', slugs: ['dft', 'made-up'], compchem: true },
          { id: 'T99', slugs: ['dft'], compchem: true },
          { id: 'T2', slugs: [], compchem: false },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;
    const r = await classifyTopics(
      [cand('T1', 'DFT stuff'), cand('T2', 'Clinical trials')],
      ['dft', 'catalysis'],
      { apiKey: 'k', model: 'm', topics: [], fetchImpl, sleepImpl: async () => {} },
    );
    expect(r).toEqual([
      { id: 'T1', slugs: ['dft'], compchem: true },
      { id: 'T2', slugs: [], compchem: false },
    ]);
    expect(body!.tools).toBeUndefined();
    expect(body!.plugins).toBeUndefined();
    expect(body!.messages[1]!.content).toMatch(/^<topics>[\s\S]*<\/topics>$/);
  });
});

describe('fetchCandidates', () => {
  it('pages through every candidate subfield with a cursor', async () => {
    const seen: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      seen.push(u);
      const first = u.searchParams.get('cursor') === '*';
      return new Response(
        JSON.stringify({
          meta: { next_cursor: first ? 'c2' : null },
          results: [
            {
              id: `https://openalex.org/T${first ? 1 : 2}`,
              display_name: 'X',
              description: 'd',
              keywords: ['k'],
              subfield: { display_name: 'S' },
              works_count: 5,
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const c = await fetchCandidates({ mailto: 'a@b.c', fetchImpl, sleepImpl: async () => {} });
    expect(c.map((x) => x.id)).toEqual(['T1', 'T2']);
    expect(seen[0]!.searchParams.get('filter')).toMatch(/^subfield\.id:1602\|/);
  });
});

describe('buildMapPrBody', () => {
  it('lists each slug’s topics with their origin and the relevant-but-unplaced ones', () => {
    const body = buildMapPrBody(
      [{ slug: 'dft', label: 'DFT' }],
      new Map([['dft', ['T1']]]),
      [cand('T1', 'Density things')],
      new Set(['dft:T1']),
      [cand('T7', 'Quantum <b>thing</b>')],
    );
    expect(body).toContain('### DFT');
    expect(body).toContain('| T1 | `Density things` | s | 10 | rule |');
    expect(body).toContain('Relevant, no slug');
    expect(body).toContain('`Quantum <b>thing</b>`');
  });
});
