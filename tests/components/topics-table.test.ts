import { readFileSync } from 'node:fs';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import TopicsTable from '../../src/components/TopicsTable.astro';

const stats = JSON.parse(readFileSync('tests/fixtures/topic-stats/valid.json', 'utf8')).topics[
  'ml-potentials'
];
const cov = { events: 1, groups: 0, positions: 0 };

describe('TopicsTable', () => {
  it('orders by papers last year, puts topics without statistics last with dashes', async () => {
    const html = await (
      await AstroContainer.create()
    ).renderToString(TopicsTable, {
      props: {
        rows: [
          { topic: { slug: 'none', label: 'No Stats' }, coverage: cov },
          { topic: { slug: 'ml-potentials', label: 'ML potentials' }, stats, coverage: cov },
        ],
      },
    });
    expect(html.indexOf('ML potentials')).toBeLessThan(html.indexOf('No Stats'));
    expect(html).toMatch(/No Stats[\s\S]*?<td[^>]*data-sort(="")?[^=>]*>\s*—\s*<\/td>/);
    expect(html).toContain('data-sort="21753"');
    expect(html).toMatch(/<polyline points="[\d., ]+"/);
    expect(html).toMatch(/<th[^>]*><button[^>]*data-sort-col/);
  });
});
