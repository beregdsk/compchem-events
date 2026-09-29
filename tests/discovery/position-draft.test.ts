import { describe, expect, it } from 'vitest';
import { positionFilePath, synthesizePositionDraft } from '../../src/lib/discovery/position-draft';
import type { ExtractedPosition } from '../../src/lib/discovery/position-extract';

const fields: ExtractedPosition = {
  title: 'PhD position in computational chemistry',
  level: 'phd',
  institution: 'University of Vienna',
  location: { city: 'Vienna', country: 'AT' },
  url: null,
  topics: ['dft'],
  description: 'A funded PhD project.',
  confidence: 0.8,
};

describe('synthesizePositionDraft', () => {
  it('builds the id from institution and title, with the year it was added', () => {
    const d = synthesizePositionDraft(fields, 'https://example.org/list', ['dft'], '2026-09-29');
    expect(d.id).toBe('university-of-vienna-phd-position-in-computational-chemistry-2026');
    expect(d.added).toBe('2026-09-29');
    expect(positionFilePath(d)).toBe(`data/positions/2026/${d.id}.yaml`);
  });

  // Review focus 5: the same generic title at two institutions must not collide.
  it('gives the same title at different institutions different ids', () => {
    const a = synthesizePositionDraft(fields, 'https://x.org', ['dft'], '2026-09-29');
    const b = synthesizePositionDraft(
      { ...fields, institution: 'ETH Zurich' },
      'https://x.org',
      ['dft'],
      '2026-09-29',
    );
    expect(a.id).not.toBe(b.id);
  });

  it('falls back to the source url when the text linked no advert', () => {
    const d = synthesizePositionDraft(fields, 'https://example.org/list', ['dft'], '2026-09-29');
    expect(d.url).toBe('https://example.org/list');
    expect(d.source_url).toBe('https://example.org/list');
  });

  it('caps a very long id at a hyphen', () => {
    const d = synthesizePositionDraft(
      { ...fields, title: 'PhD position '.repeat(20).trim() },
      'https://x.org',
      ['dft'],
      '2026-09-29',
    );
    expect(d.id.length).toBeLessThanOrEqual(85);
    expect(d.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*-2026$/);
  });

  it('omits optional fields that were not extracted', () => {
    const d = synthesizePositionDraft(fields, 'https://x.org', ['dft'], '2026-09-29');
    expect(d).not.toHaveProperty('group');
    expect(d).not.toHaveProperty('deadline');
  });
});
