import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import PositionRow from '../../src/components/PositionRow.astro';
import { formatDate } from '../../src/lib/dates';
import type { LoadedPosition } from '../../src/lib/types';

const base: LoadedPosition = {
  id: 'x-2026',
  title: 'Placeholder',
  level: 'phd',
  institution: 'University of Vienna',
  location: { city: 'Vienna', country: 'AT' },
  url: 'https://example.org/advert',
  source_url: 'https://example.org/advert',
  topics: ['dft'],
  description: 'A position.',
  added: '2026-09-01',
  status_derived: 'open',
  age_days: 28,
};

async function render(position: LoadedPosition): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(PositionRow, { props: { position } });
}

describe('PositionRow', () => {
  it('renders an open PhD with its deadline and no stale label', async () => {
    const html = await render({
      ...base,
      title: 'PhD position in computational chemistry',
      url: 'https://uni.example/phd-123',
      deadline: '2026-11-15',
    });
    expect(html).toContain('>PhD</span>');
    expect(html).toMatch(/<a href="https:\/\/uni\.example\/phd-123"[^>]*>\s*PhD position in/);
    expect(html).toContain('apply by');
    expect(html).toContain(`datetime="2026-11-15">${formatDate('2026-11-15')}</time>`);
    expect(html).not.toContain('no deadline');
    expect(html).not.toContain('may be filled');
  });

  it('renders a stale permanent post without a deadline, flagged as possibly filled', async () => {
    const html = await render({
      ...base,
      title: 'Lectureship in theoretical chemistry',
      level: 'permanent',
      url: 'https://uni.example/lecturer',
      status_derived: 'stale',
      age_days: 120,
    });
    expect(html).toContain('>Permanent</span>');
    expect(html).toMatch(/<a href="https:\/\/uni\.example\/lecturer"[^>]*>/);
    expect(html).toContain('no deadline');
    expect(html).not.toContain('apply by');
    expect(html).toContain('posted 120 days ago · may be filled');
  });
});
