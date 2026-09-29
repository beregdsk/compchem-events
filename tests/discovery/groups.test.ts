import { describe, expect, it } from 'vitest';
import { buildRegistryIndex } from '../../src/lib/discovery/group-match';
import { resolveGroupLeads, type ResolveOptions } from '../../src/lib/discovery/groups';
import type { GroupLead } from '../../src/lib/discovery/parsers/group-listing';
import { emptyState } from '../../src/lib/discovery/state';
import type { RawGroup } from '../../src/lib/types';

const LISTING = 'https://labinitio.org/explore/aust_comp_chem/';
const EVENT = 'https://example.org/workshop';

// Each page names its own URL, so the verification stub can tell which page it was sent.
const PAGES: Record<string, string> = {
  'https://www.epfl.ch/labs/cosmo/':
    '<html><body><h1>COSMO</h1><p>https://www.epfl.ch/labs/cosmo/ Machine learning for atomistic chemistry.</p></body></html>',
  'https://cootelab.com/':
    '<html><body><h1>Coote Lab</h1><p>https://cootelab.com/ Computational chemistry at Flinders University.</p></body></html>',
};

const COOTE = {
  name: 'Coote Group',
  kind: 'group',
  pi: 'Michelle Coote',
  parent: 'Flinders University',
  location: { city: 'Adelaide', country: 'AU' },
  topics: ['electronic-structure'],
  description: 'Computational quantum chemistry of radical reactions.',
  confidence: 0.8,
};

const COSMO = {
  name: 'Laboratory of Computational Science and Modeling',
  kind: 'group',
  pi: 'Michele Ceriotti',
  parent: 'EPFL',
  location: { city: 'Lausanne', country: 'CH' },
  topics: ['ml-potentials'],
  description: 'Machine learning for atomistic modelling.',
  confidence: 0.9,
};

const CECAM: RawGroup = {
  id: 'cecam',
  name: 'CECAM',
  kind: 'network',
  website: 'https://www.cecam.org/',
  topics: ['software-hpc'],
  description: 'A European network for computational science.',
  added: '2026-09-01',
};

interface World {
  /** Search query → the URLs cited in the answer. */
  searches?: Record<string, string[]>;
  /** Page URL (found in the verified page text) → the group the model reports. */
  verdicts?: Record<string, object>;
  /** The split call's items. */
  split?: Array<{ name: string; type: string; affiliation: string | null }>;
  /** Requested URL → the final URL after redirects. */
  redirects?: Record<string, string>;
}

function chat(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { total_tokens: 10 },
    }),
    { status: 200 },
  );
}

function world(w: World = {}) {
  const seen = {
    pages: [] as string[],
    queries: [] as string[],
    splits: [] as string[],
    verifications: 0,
    llmCalls: 0,
  };
  const pageFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    seen.pages.push(url);
    const body = PAGES[url];
    if (body === undefined) return new Response('', { status: 404, statusText: 'Not Found' });
    const response = new Response(body, { status: 200 });
    const finalUrl = w.redirects?.[url];
    if (finalUrl) Object.defineProperty(response, 'url', { value: finalUrl });
    return response;
  }) as typeof fetch;
  const llm = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen.llmCalls += 1;
    const body = JSON.parse(String(init?.body)) as {
      plugins?: unknown;
      messages: Array<{ content: string }>;
      response_format?: { json_schema: { name: string } };
    };
    const user = body.messages[1]!.content;
    if (body.plugins) {
      seen.queries.push(user);
      const urls = w.searches?.[user] ?? [];
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Found it.',
                annotations: urls.map((url) => ({ type: 'url_citation', url_citation: { url } })),
              },
            },
          ],
          usage: { total_tokens: 10 },
        }),
        { status: 200 },
      );
    }
    const schema = body.response_format?.json_schema.name;
    if (schema === 'organiser_names') {
      seen.splits.push(user);
      return chat({ items: w.split ?? [] });
    }
    if (schema === 'registry_entry') {
      seen.verifications += 1;
      const page = user.slice(user.indexOf('<page>'));
      const hit = Object.keys(w.verdicts ?? {}).find((url) => page.includes(url));
      return chat(hit ? { found: true, group: w.verdicts![hit] } : { found: false, group: null });
    }
    throw new Error(`unexpected LLM request: ${String(schema)}`);
  }) as typeof fetch;
  return { seen, pageFetch, llm };
}

function options(
  w: ReturnType<typeof world>,
  leads: GroupLead[],
  over: Partial<ResolveOptions> = {},
): ResolveOptions {
  return {
    leads,
    index: buildRegistryIndex([CECAM]),
    takenIds: new Set(),
    state: emptyState(),
    fetch: {
      userAgent: 'test-agent',
      fetchImpl: w.pageFetch,
      minHostIntervalMs: 0,
      sleepImpl: async () => {},
    },
    extract: {
      apiKey: 'k',
      model: 'm',
      topics: ['electronic-structure', 'ml-potentials', 'software-hpc'],
      fetchImpl: w.llm,
      sleepImpl: async () => {},
    },
    maxSearches: 20,
    maxPages: 20,
    maxTokens: 1_000_000,
    tokensUsedSoFar: 0,
    today: '2026-09-29',
    now: () => new Date('2026-09-29T06:00:00Z'),
    ...over,
  };
}

const cooteLead = (link: string): GroupLead => ({
  text: 'Michelle Coote',
  link,
  context: 'Flinders University',
  origin: LISTING,
  fromListing: true,
});

describe('resolveGroupLeads', () => {
  it('skips a name already in the registry without any model call', async () => {
    const w = world();
    const result = await resolveGroupLeads(
      options(w, [{ text: 'CECAM', origin: EVENT, fromListing: false }]),
    );
    expect(w.seen.llmCalls).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('splits people and searches each with their affiliation', async () => {
    const w = world({
      split: [
        { name: 'Stephen Cox', type: 'person', affiliation: 'Durham University' },
        { name: 'Susan Perkin', type: 'person', affiliation: 'Oxford University' },
      ],
    });
    const result = await resolveGroupLeads(
      options(w, [
        {
          text: 'Stephen Cox (Durham University); Susan Perkin (Oxford University)',
          origin: EVENT,
          fromListing: false,
        },
      ]),
    );
    expect(w.seen.splits).toHaveLength(1);
    expect(w.seen.splits[0]).toContain('Stephen Cox');
    expect(w.seen.splits[0]).toContain('Susan Perkin');
    expect(w.seen.queries).toEqual([
      '"Stephen Cox" research group Durham University',
      '"Susan Perkin" research group Oxford University',
    ]);
    expect(result.searches).toBe(2);
  });

  it('verifies a listing link first and does not search when it verifies', async () => {
    const w = world({ verdicts: { 'https://cootelab.com/': COOTE } });
    const result = await resolveGroupLeads(options(w, [cooteLead('https://cootelab.com/')]));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.draft.website).toBe('https://cootelab.com/');
    expect(result.candidates[0]!.considered).toEqual([
      { url: 'https://cootelab.com/', verdict: 'drafted' },
    ]);
    expect(result.searches).toBe(0);
  });

  it('fetches an http:// listing link as https://', async () => {
    const w = world({ verdicts: { 'https://cootelab.com/': COOTE } });
    const result = await resolveGroupLeads(options(w, [cooteLead('http://cootelab.com/')]));
    expect(w.seen.pages).toEqual(['https://cootelab.com/']);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.draft.website.startsWith('https://')).toBe(true);
  });

  it('searches instead of fetching a Google Scholar link', async () => {
    const w = world({
      searches: {
        '"Michelle Coote" research group Flinders University': ['https://cootelab.com/'],
      },
      verdicts: { 'https://cootelab.com/': COOTE },
    });
    const result = await resolveGroupLeads(
      options(w, [cooteLead('https://scholar.google.com.au/citations?user=x')]),
    );
    expect(w.seen.pages.some((u) => u.includes('scholar.google'))).toBe(false);
    expect(result.searches).toBe(1);
    expect(result.candidates.map((c) => c.draft.website)).toEqual(['https://cootelab.com/']);
  });

  it.each(['https://localhost./x', 'http://cootelab.com/'])(
    'never verifies a page that redirected to %s',
    async (finalUrl) => {
      const w = world({
        redirects: { 'https://cootelab.com/': finalUrl },
        searches: { '"Michelle Coote" Flinders University': ['https://www.epfl.ch/labs/cosmo/'] },
        verdicts: { 'https://cootelab.com/': COOTE, 'https://www.epfl.ch/labs/cosmo/': COSMO },
      });
      const result = await resolveGroupLeads(options(w, [cooteLead('https://cootelab.com/')]));
      expect(w.seen.verifications).toBe(1);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.draft.website).toBe('https://www.epfl.ch/labs/cosmo/');
      expect(result.candidates[0]!.considered).toEqual([
        { url: 'https://cootelab.com/', verdict: 'redirected to a non-public host' },
        { url: 'https://www.epfl.ch/labs/cosmo/', verdict: 'drafted' },
      ]);
    },
  );

  it('records not found in the cache and does not search again within 90 days', async () => {
    const w = world();
    const state = emptyState();
    const lead: GroupLead = { text: 'Nobody Institute', origin: LISTING, fromListing: true };

    const first = await resolveGroupLeads(options(w, [lead], { state }));
    expect(first.searches).toBe(1);
    expect(state.groupLookups['nobody institute']).toEqual({
      triedAt: '2026-09-29T06:00:00.000Z',
      outcome: 'not found',
    });

    const second = await resolveGroupLeads(options(w, [lead], { state }));
    expect(second.searches).toBe(0);

    const later = await resolveGroupLeads(
      options(w, [lead], { state, now: () => new Date('2026-12-29T06:00:00Z') }),
    );
    expect(later.searches).toBe(1);
    expect(w.seen.queries).toEqual(['"Nobody Institute"', '"Nobody Institute"']);
  });

  it('stops at maxSearches and leaves the unsearched names uncached', async () => {
    const w = world();
    const state = emptyState();
    const leads: GroupLead[] = ['Alpha Institute', 'Beta Institute', 'Gamma Institute'].map(
      (text) => ({ text, origin: LISTING, fromListing: true }),
    );
    const result = await resolveGroupLeads(options(w, leads, { state, maxSearches: 1 }));
    expect(result.searches).toBe(1);
    expect(Object.keys(state.groupLookups)).toEqual(['alpha institute']);
  });

  it('stops at maxPages and leaves the unfetched names uncached', async () => {
    const w = world();
    const state = emptyState();
    const leads: GroupLead[] = [
      { text: 'Alpha Lab', link: 'https://alpha.example/', origin: LISTING, fromListing: true },
      { text: 'Beta Lab', link: 'https://beta.example/', origin: LISTING, fromListing: true },
    ];
    const result = await resolveGroupLeads(options(w, leads, { state, maxPages: 1 }));
    expect(result.pagesFetched).toBe(1);
    expect(Object.keys(state.groupLookups)).toEqual(['alpha lab']);
  });

  it('drops a draft that fails validation', async () => {
    const w = world({ verdicts: { 'https://cootelab.com/': { ...COOTE, location: null } } });
    const state = emptyState();
    const result = await resolveGroupLeads(
      options(w, [cooteLead('https://cootelab.com/')], { state }),
    );
    expect(result.candidates).toEqual([]);
    expect(state.groupLookups['michelle coote']!.outcome).toMatch(/^invalid/);
  });
});
