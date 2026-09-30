import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import GroupRow from '../../src/components/GroupRow.astro';
import type { RawGroup } from '../../src/lib/types';

const base: RawGroup = {
  id: 'cosmo-epfl',
  name: 'Laboratory of Computational Science and Modeling',
  kind: 'group',
  pi: 'Michele Ceriotti',
  parent: 'EPFL',
  website: 'https://www.epfl.ch/labs/cosmo/',
  location: { city: 'Lausanne', country: 'CH' },
  topics: ['ml-potentials'],
  description: 'Machine learning for atomistic modelling.',
  added: '2026-09-29',
};

async function render(group: RawGroup): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(GroupRow, { props: { group } });
}

describe('GroupRow', () => {
  it('links the name to the website and shows PI, parent and place', async () => {
    const html = await render(base);
    expect(html).toMatch(
      /<a href="https:\/\/www\.epfl\.ch\/labs\/cosmo\/" rel="noopener"[^>]*>\s*Laboratory of/,
    );
    expect(html).toContain('Michele Ceriotti');
    expect(html).toContain('EPFL');
    expect(html).toContain('Lausanne, Switzerland');
  });

  it('links each topic to its topic page', async () => {
    expect(await render(base)).toContain('href="/topics/ml-potentials/"');
  });

  it('omits the place for a network without a location', async () => {
    const { location: _l, pi: _p, ...network } = base;
    const html = await render({ ...network, kind: 'network' });
    expect(html).not.toContain('Lausanne');
  });
});
