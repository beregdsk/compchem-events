import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import TrendChart from '../../src/components/TrendChart.astro';

describe('TrendChart', () => {
  it('renders one bar per year with a title and a data-table alternative', async () => {
    const c = await AstroContainer.create();
    const html = await c.renderToString(TrendChart, {
      props: {
        title: 'Papers per year',
        series: [
          { label: '2024', value: 5 },
          { label: '2025', value: 10 },
        ],
      },
    });
    expect(html).toContain('<title>Papers per year</title>');
    expect(html.match(/<rect /g)).toHaveLength(2);
    expect(html).toMatch(/<table class="visually-hidden">[\s\S]*<td>2025<\/td>\s*<td>10<\/td>/);
  });
});
