import { describe, expect, it } from 'vitest';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');

const valid = {
  id: 'example-workshop-2027',
  title: 'Example Workshop on Excited-State Methods',
  type: 'workshop',
  start_date: '2027-03-08',
  end_date: '2027-03-10',
  format: 'in-person',
  location: { city: 'Exampleville', country: 'NL' },
  url: 'https://example.org/excited-states-2027/',
  topics: ['excited-states'],
  description: 'Three days of talks and tutorials on excited-state methods.',
  added: '2026-09-20',
  last_verified: '2026-09-20',
  fixture: true,
};

const file = 'data/events/2027/example-workshop-2027.yaml';

describe('validation context', () => {
  it('loads the controlled vocabulary', () => {
    expect(ctx.topics.has('excited-states')).toBe(true);
    expect(ctx.topics.has('not-a-topic')).toBe(false);
  });

  it('starts with an empty blocklist', () => {
    expect(ctx.blockedHosts.size).toBe(0);
  });
});

describe('validateEvent schema layer', () => {
  it('accepts a valid event', () => {
    const r = validateEvent({ file, data: valid }, ctx);
    expect(r.errors).toEqual([]);
  });

  it('reports the field path for a schema violation', () => {
    const r = validateEvent({ file, data: { ...valid, url: 'http://example.org/x/' } }, ctx);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.file).toBe(file);
    expect(r.errors[0]?.field).toContain('url');
  });

  it('reports every problem, not just the first', () => {
    const r = validateEvent(
      { file, data: { ...valid, url: 'http://x.example/a/', title: 'no' } },
      ctx,
    );
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a non-object', () => {
    const r = validateEvent({ file, data: 'not an event' }, ctx);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('names missing required fields', () => {
    const { title, ...withoutTitle } = valid;
    void title;
    const r = validateEvent({ file, data: withoutTitle }, ctx);
    expect(r.errors.some((e) => e.field.includes('title'))).toBe(true);
  });
});
