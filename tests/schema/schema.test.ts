import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ValidateFunction } from 'ajv';
import type { Topic } from '../../src/lib/types';

let validate: ValidateFunction;

const base = {
  id: 'example-workshop-2027',
  title: 'Example Workshop on Excited-State Methods',
  type: 'workshop',
  start_date: '2027-03-08',
  end_date: '2027-03-10',
  format: 'in-person',
  location: { city: 'Exampleville', country: 'NL' },
  url: 'https://example.org/excited-states-2027/',
  topics: ['excited-states'],
  description: 'Three days of talks and tutorials.',
  added: '2026-09-20',
};

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync('schema/event.schema.json', 'utf8'));
  validate = ajv.compile(schema);
});

describe('event schema', () => {
  it('accepts a minimal valid event', () => {
    expect(validate(base)).toBe(true);
  });

  it('rejects an id that does not end in a year', () => {
    expect(validate({ ...base, id: 'example-workshop' })).toBe(false);
  });

  // A date that matches YYYY-MM-DD but does not exist used to pass here and
  // then crash the build with a bare RangeError in date arithmetic.
  it.each(['2027-13-01', '2027-02-30', '2026-02-29'])('rejects the impossible date %s', (d) => {
    expect(validate({ ...base, start_date: d, end_date: d })).toBe(false);
  });

  it('accepts a leap day', () => {
    expect(validate({ ...base, start_date: '2028-02-29', end_date: '2028-03-01' })).toBe(true);
  });

  it('rejects an unknown top-level property', () => {
    expect(validate({ ...base, rating: 5 })).toBe(false);
  });

  it('rejects a non-https url', () => {
    expect(validate({ ...base, url: 'http://example.org/x/' })).toBe(false);
  });

  it('rejects more than five topics', () => {
    expect(validate({ ...base, topics: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
  });

  it('rejects duplicate topics', () => {
    expect(validate({ ...base, topics: ['dft', 'dft'] })).toBe(false);
  });

  it('accepts a description of up to 8000 characters, the full-text cap', () => {
    expect(validate({ ...base, description: 'x'.repeat(8000) })).toBe(true);
    expect(validate({ ...base, description: 'x'.repeat(8001) })).toBe(false);
  });

  it('rejects a lowercase country code', () => {
    expect(validate({ ...base, location: { city: 'X', country: 'nl' } })).toBe(false);
  });

  it('requires status_note when status is cancelled', () => {
    expect(validate({ ...base, status: 'cancelled' })).toBe(false);
    expect(validate({ ...base, status: 'cancelled', status_note: 'Called off.' })).toBe(true);
  });

  it('does not require status_note when status is scheduled', () => {
    expect(validate({ ...base, status: 'scheduled' })).toBe(true);
  });

  it('requires status_note when status is postponed', () => {
    expect(validate({ ...base, status: 'postponed' })).toBe(false);
    expect(validate({ ...base, status: 'postponed', status_note: 'Moved to 2028.' })).toBe(true);
  });

  it('rejects an unknown deadline type', () => {
    expect(validate({ ...base, deadlines: [{ type: 'unknown', date: '2027-01-01' }] })).toBe(false);
  });
});

describe('controlled vocabulary', () => {
  it('parses as a list of slug/label pairs', () => {
    const topics = parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[];
    expect(topics).toHaveLength(21);
    for (const t of topics) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate slugs', () => {
    const topics = parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[];
    expect(new Set(topics.map((t) => t.slug)).size).toBe(topics.length);
  });
});

describe('yaml date handling', () => {
  it('leaves bare dates as strings, not Date objects', () => {
    // This is why the project uses `yaml` rather than `js-yaml`. If this test
    // ever fails, the UTC date invariant is broken at the parse step.
    const parsed = parse('start_date: 2027-03-08') as Record<string, unknown>;
    expect(typeof parsed.start_date).toBe('string');
    expect(parsed.start_date).toBe('2027-03-08');
  });
});

describe('blocklist', () => {
  it('parses, and is empty until there is evidence to add', () => {
    const raw = parse(readFileSync('data/blocklist.yaml', 'utf8'));
    // A comments-only YAML file parses to null.
    expect(raw ?? []).toEqual([]);
  });
});

describe('group schema', () => {
  let validateGroupSchema: ValidateFunction;
  const group = {
    id: 'example-lab',
    name: 'Example Lab',
    kind: 'network',
    website: 'https://example.org/',
    topics: ['dft'],
    description: 'A network.',
    added: '2026-09-20',
  };

  beforeAll(() => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    validateGroupSchema = ajv.compile(JSON.parse(readFileSync('schema/group.schema.json', 'utf8')));
  });

  it('accepts a network without a location', () => {
    expect(validateGroupSchema(group)).toBe(true);
  });

  it('rejects a malformed id', () => {
    expect(validateGroupSchema({ ...group, id: 'Example_Lab' })).toBe(false);
  });

  it('rejects an unknown field', () => {
    expect(validateGroupSchema({ ...group, logo: 'x.png' })).toBe(false);
  });

  it('requires a location on an institute', () => {
    expect(validateGroupSchema({ ...group, kind: 'institute' })).toBe(false);
  });
});
