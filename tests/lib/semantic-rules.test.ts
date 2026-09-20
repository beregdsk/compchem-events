import { describe, expect, it } from 'vitest';
import { loadValidationContext, validateCollection, validateEvent } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');
const file = 'data/events/2027/example-workshop-2027.yaml';

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

function errorsFor(data: unknown, path = file): string[] {
  return validateEvent({ file: path, data }, ctx).errors.map((e) => `${e.field}: ${e.message}`);
}

function warningsFor(data: unknown, path = file): string[] {
  return validateEvent({ file: path, data }, ctx).warnings.map((e) => `${e.field}: ${e.message}`);
}

describe('rule 1: id, file name and year agree', () => {
  it('accepts an id matching the file stem and start year', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it('rejects an id that differs from the file stem', () => {
    expect(errorsFor({ ...valid, id: 'other-workshop-2027' }).join()).toMatch(/file name/i);
  });

  it('rejects an id whose year differs from start_date', () => {
    expect(
      errorsFor(
        { ...valid, id: 'example-workshop-2028' },
        'data/events/2027/example-workshop-2028.yaml',
      ).join(),
    ).toMatch(/year/i);
  });

  it('rejects a file in the wrong year folder', () => {
    expect(errorsFor(valid, 'data/events/2026/example-workshop-2027.yaml').join()).toMatch(
      /folder/i,
    );
  });
});

describe('rule 2: end_date is on or after start_date', () => {
  it('rejects an end before the start', () => {
    expect(errorsFor({ ...valid, end_date: '2027-03-07' }).join()).toMatch(/end_date/);
  });

  it('accepts a single-day event', () => {
    expect(errorsFor({ ...valid, end_date: '2027-03-08' })).toEqual([]);
  });
});

describe('rule 3: added and last_verified are sane', () => {
  it('rejects a future last_verified', () => {
    expect(errorsFor({ ...valid, last_verified: '2026-09-21' }).join()).toMatch(/future/i);
  });

  it('rejects a future added', () => {
    expect(
      errorsFor({ ...valid, added: '2026-09-21', last_verified: '2026-09-21' }).join(),
    ).toMatch(/future/i);
  });

  it('rejects added after last_verified', () => {
    expect(
      errorsFor({ ...valid, added: '2026-09-20', last_verified: '2026-09-19' }).join(),
    ).toMatch(/added/i);
  });
});

describe('rule 4: topics and country are known', () => {
  it('rejects a topic outside the vocabulary', () => {
    expect(errorsFor({ ...valid, topics: ['quantum-astrology'] }).join()).toMatch(/topics/);
  });

  it('rejects a country missing from the region table', () => {
    expect(errorsFor({ ...valid, location: { city: 'X', country: 'ZZ' } }).join()).toMatch(
      /region table|country/i,
    );
  });
});

describe('rule 6: urls are https and not blocked', () => {
  it('accepts an https source_url', () => {
    expect(errorsFor({ ...valid, source_url: 'https://example.org/about/' })).toEqual([]);
  });

  it('rejects a blocked host', () => {
    const blocked = {
      ...ctx,
      blockedHosts: new Set(['predatory.example']),
    };
    const r = validateEvent(
      { file, data: { ...valid, url: 'https://predatory.example/conf/' } },
      blocked,
    );
    expect(r.errors.map((e) => e.message).join()).toMatch(/blocklist/i);
  });

  it('rejects a blocked host on a subdomain', () => {
    const blocked = { ...ctx, blockedHosts: new Set(['predatory.example']) };
    const r = validateEvent(
      { file, data: { ...valid, url: 'https://www.predatory.example/conf/' } },
      blocked,
    );
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('rule 7: no deadline after end_date', () => {
  it('rejects it', () => {
    expect(
      errorsFor({ ...valid, deadlines: [{ type: 'abstract', date: '2027-03-11' }] }).join(),
    ).toMatch(/deadlines/);
  });
});

describe('rule 8: location required unless online', () => {
  it('rejects a missing location for an in-person event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor(noLocation).join()).toMatch(/location/);
  });

  it('accepts a missing location for an online event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor({ ...noLocation, format: 'online' })).toEqual([]);
  });

  it('requires a location for a hybrid event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor({ ...noLocation, format: 'hybrid' }).join()).toMatch(/location/);
  });
});

describe('rule 9: each deadline type appears at most once', () => {
  it('rejects a repeated deadline type', () => {
    expect(
      errorsFor({
        ...valid,
        deadlines: [
          { type: 'abstract', date: '2027-01-10' },
          { type: 'abstract', date: '2027-02-10' },
        ],
      }).join(),
    ).toMatch(/more than once/i);
  });

  it('accepts distinct deadline types', () => {
    expect(
      errorsFor({
        ...valid,
        deadlines: [
          { type: 'abstract', date: '2027-01-10' },
          { type: 'registration', date: '2027-02-10' },
        ],
      }),
    ).toEqual([]);
  });
});

describe('rule 5: collection-level duplicates', () => {
  const a = { file: 'data/events/2027/a-2027.yaml', data: { ...valid, id: 'a-2027' } };

  it('rejects two events sharing an id', () => {
    const r = validateCollection([a, { ...a }], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate id/i);
  });

  it('rejects two events sharing a url', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: { ...valid, id: 'b-2027' },
    };
    const r = validateCollection([a, b], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate url/i);
  });

  it('rejects two events sharing a normalised title and start date', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'Example  Workshop on Excited-State Methods!',
      },
    };
    const r = validateCollection([a, b], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate title/i);
  });

  it('accepts genuinely distinct events', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'A Completely Different Meeting',
      },
    };
    expect(validateCollection([a, b], ctx).errors).toEqual([]);
  });

  it('rejects a hyphenated title and its spaced variant as duplicates', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'AI-Driven Drug Design Workshop',
      },
    };
    const c = {
      file: 'data/events/2027/c-2027.yaml',
      data: {
        ...valid,
        id: 'c-2027',
        url: 'https://example.org/another/',
        title: 'AI Driven Drug Design Workshop',
      },
    };
    const r = validateCollection([b, c], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate title/i);
  });

  it('does not merge two genuinely different hyphenated titles', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'AI-Driven Drug Design Workshop',
      },
    };
    const c = {
      file: 'data/events/2027/c-2027.yaml',
      data: {
        ...valid,
        id: 'c-2027',
        url: 'https://example.org/another/',
        title: 'Multi-Scale Materials Modelling Workshop',
      },
    };
    expect(validateCollection([b, c], ctx).errors).toEqual([]);
  });
});

describe('warnings', () => {
  it('warns when a deadline falls after the start date', () => {
    expect(
      warningsFor({ ...valid, deadlines: [{ type: 'registration', date: '2027-03-09' }] }).join(),
    ).toMatch(/after the start/i);
  });

  it('warns when last_verified is over 90 days old and the event has not started', () => {
    expect(
      warningsFor({ ...valid, added: '2026-01-01', last_verified: '2026-01-01' }).join(),
    ).toMatch(/90 days/);
  });

  it('warns when the description looks copied', () => {
    expect(warningsFor({ ...valid, description: 'x'.repeat(201) }).join()).toMatch(/copied/i);
  });

  it('warns when the url is a bare homepage', () => {
    expect(warningsFor({ ...valid, url: 'https://example.org' }).join()).toMatch(/homepage/i);
  });

  it('does not warn for a url with a path', () => {
    expect(warningsFor(valid).join()).not.toMatch(/homepage/i);
  });

  it('warns about identical descriptions across events', () => {
    const a = { file: 'data/events/2027/a-2027.yaml', data: { ...valid, id: 'a-2027' } };
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'A Completely Different Meeting',
      },
    };
    expect(
      validateCollection([a, b], ctx)
        .warnings.map((w) => w.message)
        .join(),
    ).toMatch(/identical description/i);
  });

  it('warnings never appear as errors', () => {
    expect(errorsFor({ ...valid, url: 'https://example.org' })).toEqual([]);
  });
});
