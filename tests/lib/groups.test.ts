import { describe, expect, it } from 'vitest';
import { buildGroupGraph, groupSections, groupSimilarity, loadGroups } from '../../src/lib/groups';
import type { RawGroup } from '../../src/lib/types';

describe('loadGroups', () => {
  it('loads the fixtures when fixtures are included', () => {
    const groups = loadGroups({
      groupsDir: 'tests/fixtures/groups/valid',
      today: '2026-09-29',
      includeFixtures: true,
    });
    expect(groups.map((g) => g.id).sort()).toEqual(['cecam', 'cosmo-epfl']);
  });

  it('drops fixtures in production mode', () => {
    expect(
      loadGroups({
        groupsDir: 'tests/fixtures/groups/valid',
        today: '2026-09-29',
        includeFixtures: false,
      }),
    ).toEqual([]);
  });

  it('is empty, not an error, when the folder does not exist', () => {
    expect(loadGroups({ groupsDir: 'tests/fixtures/groups/missing', today: '2026-09-29' })).toEqual(
      [],
    );
  });
});

describe('groupSections', () => {
  it('orders sections by kind, sorts by name and omits empty sections', () => {
    const groups = loadGroups({
      groupsDir: 'tests/fixtures/groups/valid',
      today: '2026-09-29',
      includeFixtures: true,
    });
    expect(groupSections(groups).map((s) => [s.label, s.groups.map((g) => g.id)])).toEqual([
      ['Research groups', ['cosmo-epfl']],
      ['Networks', ['cecam']],
    ]);
  });
});

const group = (id: string, over: Partial<RawGroup> = {}): RawGroup => ({
  id,
  name: id,
  kind: 'group',
  website: `https://example.org/${id}`,
  topics: ['dft'],
  description: 'A group.',
  added: '2026-09-29',
  ...over,
});

describe('groupSimilarity', () => {
  it('weighs topics, then a shared parent, then a shared country', () => {
    const at = (parent: string, country: string) =>
      group('x', { parent, location: { city: 'C', country } });
    expect(groupSimilarity(group('a'), group('b'))).toBeCloseTo(0.6);
    expect(groupSimilarity(at('Uni', 'DE'), at('uni', 'DE'))).toBe(1);
    expect(
      groupSimilarity({ ...at('Uni', 'DE'), topics: ['catalysis'] }, at('Other', 'DE')),
    ).toBeCloseTo(0.15);
  });
});

describe('buildGroupGraph', () => {
  it('shapes nodes by kind and links them to their row', () => {
    const g = buildGroupGraph([group('a'), group('b', { kind: 'society' })]);
    expect(g.nodes.map((n) => [n.href, n.shape, n.dimmed])).toEqual([
      ['/groups/#a', 'circle', false],
      ['/groups/#b', 'triangle', false],
    ]);
    expect(g.edges).toEqual([{ source: 'a', target: 'b', weight: 0.6 }]);
  });
});
