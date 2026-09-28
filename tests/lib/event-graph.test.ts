import { describe, expect, it } from 'vitest';
import {
  buildEventGraph,
  clusters,
  organizerKeys,
  relatedEvents,
  shortLabel,
  similarity,
} from '../../src/lib/event-graph';
import type { LoadedEvent } from '../../src/lib/types';

describe('organizerKeys', () => {
  it('reduces every CECAM node to the same key', () => {
    for (const name of [
      'CECAM',
      'CECAM-IT-SISSA',
      'CECAM Beijing node',
      'CECAM-NL and the University of Amsterdam',
    ]) {
      expect(organizerKeys(name).has('cecam')).toBe(true);
    }
  });

  it('ignores two-letter country codes', () => {
    expect(organizerKeys('CECAM-IT-SISSA')).toEqual(new Set(['cecam', 'sissa']));
  });

  it('splits co-organizers on semicolons', () => {
    expect(organizerKeys('CCP5; RSC Statistical Mechanics & Thermodynamics Group')).toEqual(
      new Set(['ccp5', 'rsc']),
    );
  });

  it('finds a mixed-case acronym in parentheses', () => {
    expect(organizerKeys('Molecular Sciences Software Institute (MolSSI)')).toEqual(
      new Set(['molssi']),
    );
  });

  it('falls back to the whole part when it has no acronym', () => {
    expect(organizerKeys('Telluride Science')).toEqual(new Set(['telluride science']));
  });

  it('is empty for a missing organizer', () => {
    expect(organizerKeys(undefined).size).toBe(0);
  });
});

describe('similarity', () => {
  const base = { topics: ['dft', 'excited-states'], series: undefined, organizer: undefined };

  it('scores identical topics alone at the topic weight', () => {
    expect(similarity(base, { ...base })).toBeCloseTo(0.6);
  });

  it('scores a shared series alone at the series weight', () => {
    expect(
      similarity(
        { topics: ['dft'], series: 'molsim' },
        { topics: ['catalysis'], series: 'molsim' },
      ),
    ).toBeCloseTo(0.25);
  });

  it('scores a shared organizer alone at the organizer weight', () => {
    expect(
      similarity(
        { topics: ['dft'], organizer: 'CECAM-IT-SISSA' },
        { topics: ['catalysis'], organizer: 'CECAM Beijing node' },
      ),
    ).toBeCloseTo(0.15);
  });

  it('is symmetric', () => {
    const a = { topics: ['dft', 'catalysis'], organizer: 'CCP5' };
    const b = { topics: ['dft'], organizer: 'CCP5; RSC Group' };
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a));
  });

  it('never exceeds 1', () => {
    const e = { topics: ['dft'], series: 's', organizer: 'CECAM' };
    expect(similarity(e, { ...e })).toBeLessThanOrEqual(1);
  });

  it('treats duplicate topics as a set', () => {
    expect(similarity({ topics: ['dft', 'dft'] }, { topics: ['dft'] })).toBeCloseTo(0.6);
  });

  it('is 0, not NaN, for two events with no topics', () => {
    expect(similarity({ topics: [] }, { topics: [] })).toBe(0);
  });
});

describe('shortLabel', () => {
  it('leaves a short title alone', () => {
    expect(shortLabel('Sanibel Symposium')).toBe('Sanibel Symposium');
  });

  it('truncates to the limit with an ellipsis', () => {
    const label = shortLabel('Total Energy and Force Methods Workshop 2027');
    expect([...label]).toHaveLength(28);
    expect(label.endsWith('…')).toBe(true);
  });

  it('counts code points, never splitting a surrogate pair', () => {
    const label = shortLabel('🧪'.repeat(40), 10);
    expect([...label]).toHaveLength(10);
    expect(label).toBe('🧪'.repeat(9) + '…');
  });
});

const ev = (id: string, over: Partial<LoadedEvent> = {}): LoadedEvent =>
  ({
    id,
    title: id,
    type: 'workshop',
    start_date: '2027-01-10',
    end_date: '2027-01-12',
    format: 'online',
    url: `https://example.org/${id}/`,
    topics: ['dft'],
    description: 'd',
    added: '2026-09-20',
    last_verified: '2026-09-20',
    region: 'Online',
    status_derived: 'upcoming',
    ...over,
  }) as LoadedEvent;

const key = (e: { source: string; target: string }) => [e.source, e.target].sort().join('|');

describe('buildEventGraph', () => {
  it('makes one node per event, linking to its event page', () => {
    const g = buildEventGraph([ev('a'), ev('b', { status_derived: 'past' })]);
    expect(g.nodes.map((n) => [n.id, n.href, n.status])).toEqual([
      ['a', '/events/a/', 'upcoming'],
      ['b', '/events/b/', 'past'],
    ]);
  });

  it('links pairs at or above the threshold', () => {
    const g = buildEventGraph([ev('a'), ev('b')]); // identical topics: 0.6
    expect(g.edges.map(key)).toEqual(['a|b']);
  });

  it("keeps each node's best edge even below the threshold", () => {
    const g = buildEventGraph([
      ev('a', { topics: ['dft', 'catalysis', 'spectroscopy'] }),
      ev('b', { topics: ['dft', 'soft-matter', 'drug-design'] }), // jaccard 0.2 → 0.12
    ]);
    expect(g.edges.map(key)).toEqual(['a|b']);
    expect(g.edges[0]!.weight).toBeCloseTo(0.12);
  });

  it('leaves an event sharing nothing unlinked but present', () => {
    const g = buildEventGraph([ev('a'), ev('b'), ev('lonely', { topics: ['catalysis'] })]);
    expect(g.nodes.map((n) => n.id)).toContain('lonely');
    expect(g.edges.some((e) => e.source === 'lonely' || e.target === 'lonely')).toBe(false);
  });

  it('has no self-loops and no duplicate undirected edges', () => {
    const g = buildEventGraph([
      ev('a'),
      ev('b'),
      ev('c'),
      ev('d', { topics: ['catalysis', 'dft'] }),
    ]);
    expect(g.edges.every((e) => e.source !== e.target)).toBe(true);
    const keys = g.edges.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is empty for no events', () => {
    expect(buildEventGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('clusters', () => {
  it('groups connected events, largest first, and keeps singletons', () => {
    const g = buildEventGraph([
      ev('a'),
      ev('b'),
      ev('c'),
      ev('x', { topics: ['catalysis'] }),
      ev('y', { topics: ['catalysis'] }),
      ev('lonely', { topics: ['soft-matter'] }),
    ]);
    expect(clusters(g).map((c) => c.map((n) => n.id).sort())).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y'],
      ['lonely'],
    ]);
  });

  it('orders events within a cluster newest first', () => {
    const g = buildEventGraph([
      ev('old', { start_date: '2024-01-01', end_date: '2024-01-02' }),
      ev('new', { start_date: '2027-01-01', end_date: '2027-01-02' }),
    ]);
    expect(clusters(g)[0]!.map((n) => n.id)).toEqual(['new', 'old']);
  });
});

describe('relatedEvents', () => {
  it('lists map neighbours, strongest link first', () => {
    const g = buildEventGraph([
      ev('a', { topics: ['dft', 'catalysis'] }),
      ev('weak', { topics: ['dft', 'soft-matter'] }), // jaccard 1/3 → 0.2
      ev('strong', { topics: ['dft', 'catalysis'] }), // identical → 0.6
    ]);
    expect(relatedEvents(g, 'a')).toEqual(['strong', 'weak']);
  });

  it('includes a below-threshold best link, as the map draws it', () => {
    const g = buildEventGraph([
      ev('a', { topics: ['dft', 'catalysis', 'spectroscopy'] }),
      ev('b', { topics: ['dft', 'soft-matter', 'drug-design'] }), // 0.12
    ]);
    expect(relatedEvents(g, 'a')).toEqual(['b']);
    expect(relatedEvents(g, 'b')).toEqual(['a']);
  });

  it('breaks ties by title', () => {
    const g = buildEventGraph([ev('a'), ev('z', { title: 'Beta' }), ev('y', { title: 'Alpha' })]);
    expect(relatedEvents(g, 'a')).toEqual(['y', 'z']);
  });

  it('is empty for an event sharing nothing, or an unknown id', () => {
    const g = buildEventGraph([ev('a'), ev('b'), ev('lonely', { topics: ['catalysis'] })]);
    expect(relatedEvents(g, 'lonely')).toEqual([]);
    expect(relatedEvents(g, 'missing')).toEqual([]);
  });
});
