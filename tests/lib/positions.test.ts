import { describe, expect, it } from 'vitest';
import {
  archivedPositions,
  buildPositionGraph,
  loadPositions,
  openPositions,
  positionSimilarity,
  positionStatus,
  stalePositions,
} from '../../src/lib/positions';
import type { LoadedPosition, RawPosition } from '../../src/lib/types';

const base: RawPosition = {
  id: 'p-2026',
  title: 'PhD position',
  level: 'phd',
  institution: 'Example University',
  location: { city: 'Utrecht', country: 'NL' },
  url: 'https://example.org/p',
  topics: ['dft'],
  description: 'A position.',
  added: '2026-01-01',
};

describe('positionStatus', () => {
  it('keeps a position open on its deadline day', () => {
    expect(positionStatus({ ...base, deadline: '2026-03-01' }, '2026-03-01')).toBe('open');
  });

  it('archives a position the day after its deadline', () => {
    expect(positionStatus({ ...base, deadline: '2026-03-01' }, '2026-03-02')).toBe('archived');
  });

  it('keeps a far deadline open even when the position is old', () => {
    expect(positionStatus({ ...base, deadline: '2026-12-31' }, '2026-06-01')).toBe('open');
  });

  // Review focus 4: exact boundaries for a position with no deadline.
  it.each([
    ['2026-02-14', 'open'], // day 44
    ['2026-02-15', 'stale'], // day 45
    ['2026-03-31', 'stale'], // day 89
    ['2026-04-01', 'archived'], // day 90
  ] as const)('with no deadline, on %s it is %s', (today, status) => {
    expect(positionStatus(base, today)).toBe(status);
  });
});

const loaded = (over: Partial<LoadedPosition>): LoadedPosition => ({
  ...base,
  status_derived: 'open',
  age_days: 0,
  ...over,
});

describe('ordering', () => {
  it('lists deadlines soonest first, then no-deadline positions newest first', () => {
    const list = openPositions([
      loaded({ id: 'nodl-old', added: '2026-01-01' }),
      loaded({ id: 'late', deadline: '2026-05-01' }),
      loaded({ id: 'nodl-new', added: '2026-01-10' }),
      loaded({ id: 'soon', deadline: '2026-02-01' }),
      loaded({ id: 'gone', status_derived: 'stale' }),
    ]);
    expect(list.map((p) => p.id)).toEqual(['soon', 'late', 'nodl-new', 'nodl-old']);
  });

  it('lists stale and archived positions newest first', () => {
    const ps = [
      loaded({ id: 'a', status_derived: 'stale', added: '2026-01-01' }),
      loaded({ id: 'b', status_derived: 'stale', added: '2026-01-05' }),
      loaded({ id: 'c', status_derived: 'archived', added: '2025-06-01' }),
      loaded({ id: 'd', status_derived: 'archived', added: '2025-09-01' }),
    ];
    expect(stalePositions(ps).map((p) => p.id)).toEqual(['b', 'a']);
    expect(archivedPositions(ps).map((p) => p.id)).toEqual(['d', 'c']);
  });
});

describe('loadPositions', () => {
  const dir = 'tests/fixtures/positions/valid';

  it('loads fixtures with derived status and age', () => {
    const ps = loadPositions({ positionsDir: dir, today: '2026-10-20', includeFixtures: true });
    const byId = new Map(ps.map((p) => [p.id, p]));
    expect(byId.get('phd-uni-vienna-ml-force-fields-2026')?.status_derived).toBe('open');
    expect(byId.get('postdoc-no-deadline-2026')?.status_derived).toBe('stale');
    expect(byId.get('postdoc-no-deadline-2026')?.age_days).toBe(49);
  });

  it('drops fixtures when asked to', () => {
    expect(
      loadPositions({ positionsDir: dir, today: '2026-10-20', includeFixtures: false }),
    ).toEqual([]);
  });

  it('returns nothing when the folder does not exist', () => {
    expect(loadPositions({ positionsDir: 'tests/fixtures/positions/none' })).toEqual([]);
  });

  it('throws on invalid data', () => {
    expect(() =>
      loadPositions({ positionsDir: dir, today: '2026-09-10', includeFixtures: true }),
    ).toThrow(/added .* is in the future/);
  });
});

describe('buildPositionGraph', () => {
  it('shapes nodes by level, dims archived ones and links them to the archive', () => {
    const g = buildPositionGraph([
      loaded({ id: 'a' }),
      loaded({ id: 'b', level: 'postdoc', status_derived: 'archived' }),
    ]);
    expect(g.nodes.map((n) => [n.id, n.href, n.shape, n.dimmed])).toEqual([
      ['a', '/positions/#a', 'circle', false],
      ['b', '/positions/archive/#b', 'square', true],
    ]);
  });

  it('links positions sharing topics, and more strongly at the same institution', () => {
    const elsewhere = { ...base, institution: 'Other University' };
    expect(positionSimilarity(base, elsewhere)).toBeCloseTo(0.6);
    expect(positionSimilarity(base, { ...base, institution: ' example university ' })).toBe(1);
    expect(positionSimilarity(base, { ...elsewhere, topics: ['catalysis'] })).toBe(0);
  });
});
