import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGroupListing } from '../../../src/lib/discovery/parsers/group-listing';

const page = (name: string) => readFileSync(`tests/discovery/fixtures/pages/${name}.html`, 'utf8');

describe('parseGroupListing', () => {
  it('reads labinitio PIs with their institution heading as context', () => {
    const leads = parseGroupListing(
      page('labinitio-groups'),
      'https://labinitio.org/explore/aust_comp_chem/',
    );
    expect(leads).toContainEqual(
      expect.objectContaining({
        text: 'Michelle Coote',
        link: 'https://cootelab.com/',
        context: 'Flinders University',
        fromListing: true,
      }),
    );
    expect(leads.every((l) => l.origin === 'https://labinitio.org/explore/aust_comp_chem/')).toBe(
      true,
    );
  });

  it('drops navigation, footer and same-page anchors', () => {
    const leads = parseGroupListing(
      page('labinitio-groups'),
      'https://labinitio.org/explore/aust_comp_chem/',
    );
    expect(leads.map((l) => l.text)).not.toContain('Home');
    expect(leads.map((l) => l.text)).not.toContain('Twitter');
    expect(leads.some((l) => l.link?.includes('labinitio.org'))).toBe(false);
  });

  it('reads curlie entries and skips its own flag links', () => {
    const leads = parseGroupListing(
      page('curlie-groups'),
      'https://curlie.org/Science/Chemistry/Computational/Research_Groups/',
    );
    expect(leads.map((l) => l.text)).toContain('Case, David A.');
    expect(leads.some((l) => l.link?.includes('curlie.org'))).toBe(false);
  });

  it('reads XFEL rows with the table caption as context', () => {
    const leads = parseGroupListing(
      page('xfel-theory-groups'),
      'https://www.xfel.eu/x/index_eng.html',
    );
    expect(leads.length).toBeGreaterThan(0);
    expect(
      leads.every((l) => l.context === 'Atoms, molecules, clusters and gas phase chemistry'),
    ).toBe(true);
    expect(leads.some((l) => l.link?.startsWith('#'))).toBe(false);
  });
});
