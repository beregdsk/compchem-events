import { describe, expect, it } from 'vitest';
import { loadValidationContext } from '../../src/lib/validation';
import {
  readPositionFiles,
  validatePosition,
  validatePositionCollection,
} from '../../src/lib/position-validation';
import type { RawPosition } from '../../src/lib/types';

const ctx = loadValidationContext('.', '2026-09-29');
const FILE = 'data/positions/2026/phd-example-2026.yaml';

const valid: RawPosition = {
  id: 'phd-example-2026',
  title: 'PhD position in quantum chemistry',
  level: 'phd',
  institution: 'Example University',
  location: { city: 'Utrecht', country: 'NL' },
  url: 'https://example.org/jobs/phd-1',
  topics: ['electronic-structure'],
  description: 'A funded PhD project.',
  added: '2026-09-20',
};

const errorsFor = (data: unknown, file = FILE) =>
  validatePosition({ file, data }, ctx).errors.map((e) => `${e.field}: ${e.message}`);

describe('validatePosition', () => {
  it('accepts a minimal valid position', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it('caps the description at 600 characters unless it is a linkless mailing-list post', () => {
    const list = 'https://www.ccpbiosim.org/';
    const long = 'A funded PhD project.\n'.repeat(40);
    expect(errorsFor({ ...valid, description: long }).join()).toMatch(/at most 600/);
    expect(errorsFor({ ...valid, url: list, source_url: list, description: long })).toEqual([]);
  });

  it('accepts the committed fixtures', () => {
    const entries = readPositionFiles('tests/fixtures/positions/valid');
    expect(entries.length).toBe(2);
    for (const entry of entries) expect(validatePosition(entry, ctx).errors).toEqual([]);
  });

  it('rejects an unknown level', () => {
    expect(errorsFor({ ...valid, level: 'industry' }).join()).toMatch(/level/);
  });

  it('rejects an http url', () => {
    expect(errorsFor({ ...valid, url: 'http://example.org/jobs/phd-1' }).join()).toMatch(/url/);
  });

  it('rejects an unknown field such as last_verified', () => {
    expect(errorsFor({ ...valid, last_verified: '2026-09-20' }).join()).toMatch(
      /additional properties/,
    );
  });

  it('rejects a topic outside the vocabulary', () => {
    expect(errorsFor({ ...valid, topics: ['basket-weaving'] }).join()).toMatch(/unknown topic/);
  });

  it('rejects an unknown country', () => {
    expect(errorsFor({ ...valid, location: { city: 'X', country: 'ZZ' } }).join()).toMatch(
      /country/,
    );
  });

  it('rejects an id that does not match the file name', () => {
    expect(errorsFor(valid, 'data/positions/2026/other-2026.yaml').join()).toMatch(/file name/);
  });

  it('rejects an id whose year is not the year of added', () => {
    expect(errorsFor({ ...valid, added: '2025-12-30' }).join()).toMatch(/added/);
  });

  it('rejects a file outside the folder for its added year', () => {
    expect(errorsFor(valid, 'data/positions/2025/phd-example-2026.yaml').join()).toMatch(/folder/);
  });

  it('rejects a future added', () => {
    expect(errorsFor({ ...valid, id: 'phd-example-2026', added: '2026-12-01' }).join()).toMatch(
      /future/,
    );
  });

  it('rejects an impossible deadline with a clear message', () => {
    expect(errorsFor({ ...valid, deadline: '2026-02-30' }).join()).toMatch(/deadline: .*date/);
  });

  it('rejects a blocklisted host', () => {
    const blocked = { ...ctx, blockedHosts: new Set(['example.org']) };
    const r = validatePosition({ file: FILE, data: valid }, blocked);
    expect(r.errors.map((e) => e.message).join()).toMatch(/blocklist/);
  });
});

describe('validatePositionCollection', () => {
  const entry = (p: RawPosition) => ({
    file: `data/positions/2026/${p.id}.yaml`,
    data: p,
  });

  it('flags a duplicate id', () => {
    const r = validatePositionCollection([entry(valid), entry(valid)]);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate id/);
  });

  it('flags a duplicate advert url', () => {
    const other = { ...valid, id: 'phd-other-2026', title: 'Another PhD position' };
    const r = validatePositionCollection([entry(valid), entry(other)]);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate url/);
  });

  // Review focus 1: mailbox posts without an advert link all fall back to the
  // list's info page, so a shared url that equals source_url is not a duplicate.
  it('does not flag a shared fallback url (url equals source_url)', () => {
    const fallback = 'https://example.org/list-info';
    const a = { ...valid, url: fallback, source_url: fallback };
    const b = { ...a, id: 'phd-other-2026', title: 'Another PhD position' };
    expect(validatePositionCollection([entry(a), entry(b)]).errors).toEqual([]);
  });

  it('flags a duplicate title at the same institution', () => {
    const b = { ...valid, id: 'phd-copy-2026', url: 'https://example.org/jobs/phd-2' };
    const r = validatePositionCollection([entry(valid), entry(b)]);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate title/);
  });

  it('allows the same title at different institutions', () => {
    const b = {
      ...valid,
      id: 'phd-copy-2026',
      url: 'https://example.org/jobs/phd-2',
      institution: 'Other University',
    };
    expect(validatePositionCollection([entry(valid), entry(b)]).errors).toEqual([]);
  });
});
