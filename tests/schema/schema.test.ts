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
  last_verified: '2026-09-20',
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

  it('rejects a description over 280 characters', () => {
    expect(validate({ ...base, description: 'x'.repeat(281) })).toBe(false);
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

  it('rejects a repeated deadline shape error', () => {
    expect(validate({ ...base, deadlines: [{ type: 'unknown', date: '2027-01-01' }] })).toBe(false);
  });
});

describe('controlled vocabulary', () => {
  it('parses as a list of slug/label pairs', () => {
    const topics = parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[];
    expect(topics).toHaveLength(20);
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
