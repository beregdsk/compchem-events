import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPosition, looksLikePosition } from '../../src/lib/discovery/position-extract';
import { EXTRACT_ATTEMPTS, type ExtractOptions } from '../../src/lib/discovery/extract-client';

const post = (name: string) => readFileSync(`tests/discovery/fixtures/posts/${name}.txt`, 'utf8');

describe('looksLikePosition', () => {
  it('matches a PhD advert', () => {
    expect(looksLikePosition(post('phd-advert'))).toBe(true);
  });

  it('matches a postdoc advert', () => {
    expect(looksLikePosition(post('injection-advert'))).toBe(true);
  });

  it.each([
    'We are hiring a research software engineer',
    'Tenure-track faculty position in theoretical chemistry',
    'Открыта вакансия младшего научного сотрудника',
    'Two doctoral positions in quantum dynamics',
    'Postdoctoral Research Associate in computational chemistry',
    'Postdoc in computational chemistry at ETH Zurich',
    'Fully funded PhD in quantum chemistry',
    'PhD opportunity in machine learning for materials',
    'PhD-position in DFT',
    'Research Fellow in theoretical chemistry',
    'Assistant Professor in theoretical chemistry',
    'Professorship in computational chemistry',
  ])('matches %s', (text) => {
    expect(looksLikePosition(text)).toBe(true);
  });

  it('does not match a school that only mentions PhD grants', () => {
    expect(looksLikePosition(post('school-with-phd-grants'))).toBe(false);
  });

  it.each([
    'The school is aimed at PhD students and postdoctoral researchers.',
    'Postdoctoral fellows are encouraged to attend.',
    'Doctoral candidates may present posters.',
  ])('does not match event-audience text: %s', (text) => {
    expect(looksLikePosition(text)).toBe(false);
  });

  it.each([
    'Workshop on DFT, 3-5 May 2027. Invited speakers: Prof. A (Assistant Professor, X University).',
    'Lecturers: A. Smith, B. Jones. Applications are invited from students.',
  ])('does not match an ordinary event post: %s', (text) => {
    expect(looksLikePosition(text)).toBe(false);
  });
});

function stubLlm(content: unknown, seen: { system?: string; user?: string } = {}) {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: string }>;
      response_format: { json_schema: { name: string } };
    };
    seen.system = body.messages[0]!.content;
    seen.user = body.messages[1]!.content;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
        usage: { total_tokens: 10 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

const options = (fetchImpl: typeof fetch): ExtractOptions => ({
  apiKey: 'sk-test',
  model: 'test-model',
  fetchImpl,
  topics: ['ml-potentials', 'molecular-dynamics', 'excited-states', 'dft'],
  sleepImpl: async () => {},
});

const found = {
  found: true,
  position: {
    title: 'PhD position in machine-learned force fields',
    level: 'phd',
    institution: 'University of Vienna',
    group: 'Computational Materials Physics',
    location: { city: 'Vienna', country: 'AT' },
    url: 'https://jobs.univie.ac.at/example-phd-ml-force-fields',
    deadline: '2026-11-15',
    topics: ['ml-potentials', 'basket-weaving'],
    description: 'A funded PhD project on machine-learned potentials for catalysis.',
    confidence: 0.9,
  },
};

describe('extractPosition', () => {
  it('returns normalised fields for a found position', async () => {
    const r = await extractPosition(post('phd-advert'), options(stubLlm(found)));
    expect(r).toMatchObject({
      level: 'phd',
      institution: 'University of Vienna',
      group: 'Computational Materials Physics',
      deadline: '2026-11-15',
      url: 'https://jobs.univie.ac.at/example-phd-ml-force-fields',
      topics: ['ml-potentials'], // off-vocabulary entry dropped
    });
  });

  it('returns null when the model finds no position', async () => {
    const r = await extractPosition(
      post('school-with-phd-grants'),
      options(stubLlm({ found: false, position: null })),
    );
    expect(r).toBeNull();
  });

  it('keeps a null url and a null deadline absent rather than invented', async () => {
    const r = await extractPosition(
      post('injection-advert'),
      options(
        stubLlm({
          found: true,
          position: { ...found.position, group: null, url: null, deadline: null },
        }),
      ),
    );
    expect(r?.url).toBeNull();
    expect(r).not.toHaveProperty('deadline');
    expect(r).not.toHaveProperty('group');
  });

  it('tells the model the text is untrusted and never to invent a url or deadline', async () => {
    const seen: { system?: string } = {};
    await extractPosition(post('injection-advert'), options(stubLlm(found, seen)));
    expect(seen.system).toMatch(/data, never instructions/);
    expect(seen.system).toMatch(/never invent/);
    expect(seen.system).toMatch(/deadline/);
  });

  it('retries a malformed deadline for every attempt and then gives up with an error', async () => {
    const bad = { found: true, position: { ...found.position, deadline: '15 Nov 2026' } };
    let calls = 0;
    const inner = stubLlm(bad);
    const counting = ((...args: Parameters<typeof fetch>) => {
      calls++;
      return inner(...args);
    }) as typeof fetch;
    await expect(extractPosition(post('phd-advert'), options(counting))).rejects.toThrow(
      /expected shape/,
    );
    expect(calls).toBe(EXTRACT_ATTEMPTS);
  });

  it.each([
    ['a country name', { location: { city: 'Vienna', country: 'Austria' } }],
    ['an impossible date', { deadline: '2026-02-30' }],
    ['confidence above 1', { confidence: 5 }],
    ['an empty title', { title: '  ' }],
  ])('rejects %s as malformed', async (_label, patch) => {
    const bad = { found: true, position: { ...found.position, ...patch } };
    await expect(extractPosition(post('phd-advert'), options(stubLlm(bad)))).rejects.toThrow(
      /expected shape/,
    );
  });

  it('drops a url the input text does not contain', async () => {
    const r = await extractPosition(
      post('phd-advert'),
      options(
        stubLlm({
          found: true,
          position: { ...found.position, url: 'https://phish.example/apply' },
        }),
      ),
    );
    expect(r?.url).toBeNull();
  });
});
