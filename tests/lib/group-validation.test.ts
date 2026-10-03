import { describe, expect, it } from 'vitest';
import { loadValidationContext } from '../../src/lib/validation';
import {
  normaliseGroupName,
  readGroupFiles,
  validateGroup,
  validateGroupCollection,
  websiteKey,
} from '../../src/lib/group-validation';
import type { RawGroup } from '../../src/lib/types';

const ctx = loadValidationContext('.', '2026-09-29');
const FILE = 'data/groups/example-lab.yaml';

const valid: RawGroup = {
  id: 'example-lab',
  name: 'Example Theory Lab',
  kind: 'group',
  pi: 'Ada Example',
  website: 'https://example.org/lab/',
  location: { city: 'Utrecht', country: 'NL' },
  topics: ['electronic-structure'],
  description: 'Builds electronic-structure methods.',
  added: '2026-09-20',
};

const errorsFor = (data: unknown, file = FILE) =>
  validateGroup({ file, data }, ctx).errors.map((e) => `${e.field}: ${e.message}`);

const collectionErrors = (...groups: RawGroup[]) =>
  validateGroupCollection(
    groups.map((g) => ({ file: `data/groups/${g.id}.yaml`, data: g })),
  ).errors.map((e) => `${e.field}: ${e.message}`);

describe('validateGroup', () => {
  it('accepts a minimal valid group', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it('requires pi to name each head in full', () => {
    for (const pi of [
      'Wataru Shinoda',
      'Prof. Dr. Markus Reiher',
      'Dr Agnes Noy',
      'Tangui Le Bahers and Stephan Steinmann',
      'David Dubbeldam, Bernd Ensing, Peter Bolhuis',
    ]) {
      expect(errorsFor({ ...valid, pi }), pi).toEqual([]);
    }
    for (const pi of ['Sam', 'Prof. Shinoda', 'Prof Yu', 'Jeschke and Otsuki']) {
      expect(errorsFor({ ...valid, pi }).join(), pi).toMatch(/^pi: .*given name and family name/);
    }
  });

  it('accepts the committed fixtures', () => {
    const entries = readGroupFiles('tests/fixtures/groups/valid');
    expect(entries.length).toBe(2);
    for (const entry of entries) expect(validateGroup(entry, ctx).errors).toEqual([]);
  });

  it('returns no files for a missing folder', () => {
    expect(readGroupFiles('tests/fixtures/groups/does-not-exist')).toEqual([]);
  });

  it('rejects an id that differs from the file name', () => {
    expect(errorsFor(valid, 'data/groups/other.yaml').join()).toMatch(/id/);
  });

  it('rejects an unknown kind', () => {
    expect(errorsFor({ ...valid, kind: 'company' }).join()).toMatch(/kind/);
  });

  it('rejects pi on a network', () => {
    expect(errorsFor({ ...valid, kind: 'network' }).join()).toMatch(/kind/);
  });

  it('requires a location on a group but not on a society', () => {
    const { location: _drop, ...noLocation } = valid;
    expect(errorsFor(noLocation).join()).toMatch(/location/);
    const { pi: _pi, ...society } = noLocation;
    expect(errorsFor({ ...society, kind: 'society' })).toEqual([]);
  });

  it('rejects an unknown topic and an unknown country', () => {
    expect(errorsFor({ ...valid, topics: ['astrology'] }).join()).toMatch(/unknown topic/);
    expect(errorsFor({ ...valid, location: { city: 'X', country: 'ZZ' } }).join()).toMatch(
      /region table/,
    );
  });

  it('rejects an http website and a future added date', () => {
    expect(errorsFor({ ...valid, website: 'http://example.org/lab/' }).join()).toMatch(/website/);
    expect(errorsFor({ ...valid, added: '2026-10-01' }).join()).toMatch(/future/);
  });

  it('rejects an alias equal to its own name', () => {
    expect(errorsFor({ ...valid, aliases: ['example theory lab'] }).join()).toMatch(/aliases/);
  });

  it('warns about a long description with no full stop', () => {
    const r = validateGroup({ file: FILE, data: { ...valid, description: 'x '.repeat(110) } }, ctx);
    expect(r.warnings.map((w) => w.field)).toEqual(['description']);
  });
});

describe('validateGroupCollection', () => {
  const other: RawGroup = {
    ...valid,
    id: 'other-lab',
    name: 'Other Lab',
    pi: 'Bo Other',
    website: 'https://other.example/',
  };

  it('accepts two distinct groups', () => {
    expect(collectionErrors(valid, other)).toEqual([]);
  });

  it('rejects a duplicate website, ignoring host case and a trailing slash', () => {
    expect(
      collectionErrors(valid, { ...other, website: 'https://EXAMPLE.org/lab' }).join(),
    ).toMatch(/duplicate website/);
  });

  it("rejects a name shared with another entry's alias", () => {
    expect(collectionErrors(valid, { ...other, aliases: ['Example Theory-Lab'] }).join()).toMatch(
      /duplicate name/,
    );
  });
});

describe('normaliseGroupName / websiteKey', () => {
  it('folds case, punctuation and diacritics', () => {
    expect(normaliseGroupName('  Université de  Genève (UNIGE) ')).toBe(
      'universite de geneve unige',
    );
  });

  it('keys a website by lowercase host without www. and path without trailing slash', () => {
    expect(websiteKey('https://WWW.Example.org/Lab/')).toBe('example.org/Lab');
    expect(websiteKey('https://www.cootelab.com/')).toBe(websiteKey('https://cootelab.com'));
  });
});
