import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import TopicStatsBlock from '../../src/components/TopicStatsBlock.astro';

const stats = JSON.parse(readFileSync('tests/fixtures/topic-stats/valid.json', 'utf8')).topics[
  'ml-potentials'
];
const render = async (s = stats) =>
  (await AstroContainer.create()).renderToString(TopicStatsBlock, {
    props: {
      stats: s,
      coverage: { events: 3, groups: 2, positions: 1 },
      slug: 'ml-potentials',
      generatedAt: '2026-10-02',
    },
  });

describe('TopicStatsBlock', () => {
  it('links institutions and papers only through https, and shows the rest as text', async () => {
    const html = await render();
    expect(html).toMatch(/<a href="https:\/\/www\.umich\.edu"[^>]*>University of Michigan<\/a>/);
    expect(html).toContain('No Homepage Institute');
    expect(html).not.toMatch(/<a [^>]*>No Homepage Institute/);
    expect(html).toMatch(/<a href="https:\/\/doi\.org\/10\.1\/x"[^>]*>A paper<\/a>/);
    expect(html).not.toMatch(/<a [^>]*>No DOI paper/);
  });

  it('escapes hostile text from OpenAlex', async () => {
    const s = structuredClone(stats);
    s.top_papers[0].title = '<script>alert(1)</script>';
    const html = await render(s);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows the citation caveat, growth dash, coverage links and attribution', async () => {
    const s = structuredClone(stats);
    s.growth_5y = null;
    const html = await render(s);
    expect(html).toContain('citations to papers in these topics');
    expect(html).toMatch(/Growth over five years<\/dt>\s*<dd>—<\/dd>/);
    expect(html).toContain('href="/?topics=ml-potentials"');
    expect(html).toContain('OpenAlex');
    expect(html).toContain('2026-10-02');
    expect(html).toContain('href="https://openalex.org/T11948"');
  });
});
