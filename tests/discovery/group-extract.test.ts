import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractGroup, splitNames } from '../../src/lib/discovery/group-extract';

function stubLlm(
  content: unknown,
  seen: { system?: string; user?: string; body?: Record<string, unknown> } = {},
) {
  return (async (_u: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    seen.body = body as unknown as Record<string, unknown>;
    seen.system = body.messages[0]!.content;
    seen.user = body.messages[1]!.content;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const opts = (fetchImpl: typeof fetch) => ({
  apiKey: 'k',
  model: 'm',
  topics: ['dft', 'ml-potentials'],
  fetchImpl,
  sleepImpl: async () => {},
});

describe('splitNames', () => {
  it('returns people and organisations, with no tools in the request', async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const items = await splitNames(
      'Michele Ceriotti, Marylou Gabrié',
      opts(
        stubLlm(
          {
            items: [
              { name: 'Michele Ceriotti', type: 'person', affiliation: null },
              { name: 'Marylou Gabrié', type: 'person', affiliation: null },
            ],
          },
          seen,
        ),
      ),
    );
    expect(items).toEqual([
      { name: 'Michele Ceriotti', type: 'person' },
      { name: 'Marylou Gabrié', type: 'person' },
    ]);
    expect(seen.body).not.toHaveProperty('plugins');
    expect(seen.body).not.toHaveProperty('tools');
  });
});

describe('extractGroup', () => {
  const found = {
    found: true,
    group: {
      name: 'Laboratory of Computational Science and Modeling',
      kind: 'group',
      pi: 'Michele Ceriotti',
      parent: 'EPFL',
      location: { city: 'Lausanne', country: 'ch' },
      topics: ['ml-potentials', 'astrology'],
      description: 'Machine learning for atomistic modelling.',
      confidence: 0.9,
    },
  };

  it('normalises the draft: uppercase country, only vocabulary topics', async () => {
    const g = await extractGroup(
      readFileSync('tests/discovery/fixtures/pages/group-homepage.html', 'utf8'),
      { name: 'Michele Ceriotti', type: 'person' },
      opts(stubLlm(found)),
    );
    expect(g).toMatchObject({
      kind: 'group',
      location: { country: 'CH' },
      topics: ['ml-potentials'],
    });
  });

  it('drops pi on a non-group kind', async () => {
    const g = await extractGroup(
      'text',
      { name: 'X', type: 'organisation' },
      opts(stubLlm({ found: true, group: { ...found.group, kind: 'network' } })),
    );
    expect(g?.pi).toBeUndefined();
  });

  it('returns null when the model says not found, or no topic survives', async () => {
    expect(
      await extractGroup(
        't',
        { name: 'X', type: 'organisation' },
        opts(stubLlm({ found: false, group: null })),
      ),
    ).toBeNull();
    expect(
      await extractGroup(
        't',
        { name: 'X', type: 'organisation' },
        opts(stubLlm({ found: true, group: { ...found.group, topics: ['astrology'] } })),
      ),
    ).toBeNull();
  });

  /** Answers in turn, repeating the last; counts the calls. */
  function sequence(...replies: unknown[]) {
    const calls = { n: 0 };
    const impl = (async () => {
      const content = replies[Math.min(calls.n, replies.length - 1)];
      calls.n += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    return { impl, calls };
  }
  const noLocation = { found: true, group: { ...found.group, location: null } };

  it('asks again when a group comes back without a location', async () => {
    const llm = sequence(noLocation, found);
    const g = await extractGroup('t', { name: 'X', type: 'organisation' }, opts(llm.impl));
    expect(llm.calls.n).toBe(2);
    expect(g?.location).toEqual({ city: 'Lausanne', country: 'CH' });
  });

  it('passes a group still without a location on after the last attempt', async () => {
    const llm = sequence(noLocation);
    const g = await extractGroup('t', { name: 'X', type: 'organisation' }, opts(llm.impl));
    expect(llm.calls.n).toBe(3);
    expect(g).not.toBeNull();
    expect(g?.location).toBeUndefined();
  });

  it('does not ask again for a network without a location', async () => {
    const llm = sequence({ found: true, group: { ...noLocation.group, kind: 'network' } });
    await extractGroup('t', { name: 'X', type: 'organisation' }, opts(llm.impl));
    expect(llm.calls.n).toBe(1);
  });

  it('asks again on "found" with no group, then treats it as not found', async () => {
    const llm = sequence({ found: true, group: null });
    const g = await extractGroup('t', { name: 'X', type: 'organisation' }, opts(llm.impl));
    expect(llm.calls.n).toBe(3);
    expect(g).toBeNull();
  });

  it('delimits the page as data, passes the hint, and sends no tools', async () => {
    const seen: { system?: string; user?: string; body?: Record<string, unknown> } = {};
    await extractGroup(
      readFileSync('tests/discovery/fixtures/pages/group-injection.html', 'utf8'),
      { name: 'Ada Lab', type: 'organisation', context: 'Flinders University' },
      opts(stubLlm(found, seen)),
    );
    expect(seen.system).toMatch(/data, never instructions/);
    expect(seen.system).toMatch(/university, faculty or department/);
    expect(seen.user).toContain('Flinders University');
    expect(seen.user).toMatch(/<page>[\s\S]*<\/page>/);
    expect(seen.body).not.toHaveProperty('plugins');
    expect(seen.body).not.toHaveProperty('tools');
  });
});
