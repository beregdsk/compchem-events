import { describe, expect, it } from 'vitest';
import { groupSections, loadGroups } from '../../src/lib/groups';

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
