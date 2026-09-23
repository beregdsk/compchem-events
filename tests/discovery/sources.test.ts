import { describe, expect, it } from 'vitest';
import { loadSources, SOURCE_KINDS } from '../../src/lib/discovery/sources';

describe('loadSources', () => {
  it('parses valid entries and skips malformed ones', () => {
    const sources = loadSources('tests/discovery/fixtures/sources/sample.yaml');
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      name: 'Good Listing',
      url: 'https://example.org/events',
      kind: 'listing-page',
      added: '2026-09-23',
      last_checked: '2026-09-23',
      notes: 'A sample listing page.',
    });
    expect(sources[1]!.kind).toBe('rss');
  });

  it('loads the real data/sources.yaml with every entry a known kind', () => {
    const sources = loadSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(SOURCE_KINDS).toContain(s.kind);
      expect(s.url.startsWith('https://')).toBe(true);
    }
  });
});
