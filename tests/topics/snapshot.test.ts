import { describe, expect, it } from 'vitest';
import {
  buildSlugStats,
  buildSnapshot,
  buildSnapshotPrBody,
  growth5y,
} from '../../src/lib/topics/snapshot';

const O = 'https://openalex.org/';
function world(fail?: (u: URL) => boolean) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(
      `${u.pathname} ${u.searchParams.get('filter')} ${u.searchParams.get('group_by') ?? ''}`,
    );
    if (fail?.(u)) return new Response('{}', { status: 400 });
    const g = u.searchParams.get('group_by');
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.pathname === '/topics') {
      return json({
        results: [
          { id: `${O}T1`, display_name: 'Topic One', works_count: 100, cited_by_count: 1000 },
          { id: `${O}T2`, display_name: 'Topic Two', works_count: 50, cited_by_count: 500 },
        ],
      });
    }
    if (u.pathname === '/institutions') {
      return json({
        results: [
          {
            id: `${O}I1`,
            display_name: 'Uni One',
            country_code: 'US',
            homepage_url: 'https://one.edu',
          },
          {
            id: `${O}I2`,
            display_name: 'Uni Two',
            country_code: null,
            homepage_url: 'http://two.edu',
          },
        ],
      });
    }
    if (g === 'publication_year') {
      return json({
        group_by: [
          { key: '2025', key_display_name: '2025', count: 30 },
          { key: '2020', key_display_name: '2020', count: 10 },
        ],
      });
    }
    if (g === 'authorships.institutions.id') {
      return json({
        group_by: [
          { key: `${O}I1`, key_display_name: 'Uni One', count: 9 },
          { key: 'unknown', key_display_name: 'unknown', count: 99 },
          { key: `${O}I2`, key_display_name: 'Uni Two', count: 5 },
        ],
      });
    }
    if (g === 'primary_location.source.id') {
      return json({ group_by: [{ key: `${O}S1`, key_display_name: 'J. Chem. Phys.', count: 7 }] });
    }
    if (u.searchParams.get('sort') === 'cited_by_count:desc') {
      return json({
        results: [
          {
            title: 'Top <b>paper</b>',
            doi: 'https://doi.org/10.1/a',
            cited_by_count: 50,
            publication_year: 2024,
          },
          { title: 'No DOI', doi: null, cited_by_count: 5, publication_year: 2023 },
          { title: null, doi: null, cited_by_count: 1, publication_year: 2023 },
        ],
      });
    }
    return json({ meta: { count: 150 }, results: [] });
  }) as typeof fetch;
  return { calls, o: { mailto: 'a@b.c', fetchImpl, sleepImpl: async () => {} } };
}

describe('growth5y', () => {
  it('is last full year over five years before, or null without a base', () => {
    const series = (a: number, b: number) =>
      [2020, 2021, 2022, 2023, 2024, 2025].map((year, i) => ({
        year,
        works: i === 0 ? a : i === 5 ? b : 1,
      }));
    expect(growth5y(series(10, 30))).toBe(3);
    expect(growth5y(series(0, 30))).toBeNull();
    expect(growth5y([])).toBeNull();
  });
});

describe('buildSlugStats', () => {
  it('fills 15 full years, keeps only real ids and https links, and sums topic citations', async () => {
    const w = world();
    const s = await buildSlugStats(['T1', 'T2'], 2026, w.o);
    expect(s.works_by_year).toHaveLength(15);
    expect(s.works_by_year[0]).toEqual({ year: 2011, works: 0 });
    expect(s.works_by_year.at(-1)).toEqual({ year: 2025, works: 30 });
    expect(s.growth_5y).toBe(3);
    expect(s.works_total).toBe(150);
    expect(s.citations_total).toBe(1500);
    expect(s.top_institutions).toEqual([
      { id: 'I1', name: 'Uni One', country: 'US', homepage: 'https://one.edu', works: 9 },
      { id: 'I2', name: 'Uni Two', works: 5 },
    ]);
    expect(s.top_venues).toEqual([{ id: 'S1', name: 'J. Chem. Phys.', works: 7 }]);
    expect(s.top_papers).toEqual([
      { title: 'Top <b>paper</b>', year: 2024, doi: 'https://doi.org/10.1/a', citations: 50 },
      { title: 'No DOI', year: 2023, citations: 5 },
    ]);
    expect(s.subtopics.map((t) => t.id)).toEqual(['T1', 'T2']);
    expect(w.calls.some((c) => c.includes('topics.id:T1|T2,publication_year:2011-2025'))).toBe(
      true,
    );
    expect(
      w.calls.some((c) =>
        c.includes('publication_year:2023-2025,primary_location.source.type:journal'),
      ),
    ).toBe(true);
  });
});

describe('buildSnapshot', () => {
  const topics = [
    { slug: 'a', label: 'A', openalex: ['T1'] },
    { slug: 'b', label: 'B', openalex: ['T2'] },
    { slug: 'c', label: 'C' },
  ];

  it('covers every mapped slug and skips unmapped ones', async () => {
    const snap = await buildSnapshot(topics, '2026-10-02', world().o);
    expect(snap).toMatchObject({
      schema_version: 1,
      generated_at: '2026-10-02',
      source: 'OpenAlex',
    });
    expect(Object.keys(snap.topics)).toEqual(['a', 'b']);
  });

  it('fails as a whole when one slug fails', async () => {
    const w = world((u) => (u.searchParams.get('filter') ?? '').startsWith('topics.id:T2'));
    await expect(buildSnapshot(topics, '2026-10-02', w.o)).rejects.toThrow(/slug "b"/);
  });
});

describe('buildSnapshotPrBody', () => {
  it('tables works last year and growth, with the change from the previous snapshot', async () => {
    const next = await buildSnapshot(
      [{ slug: 'a', label: 'A', openalex: ['T1'] }],
      '2026-10-02',
      world().o,
    );
    const prev = structuredClone(next);
    prev.topics.a!.works_by_year.at(-1)!.works = 20;
    const body = buildSnapshotPrBody(next, prev, new Map([['a', 'Alpha']]));
    expect(body).toContain('| Alpha | 30 | +10 | 3.00× |');
    expect(body).toContain('OpenAlex');
  });
});
