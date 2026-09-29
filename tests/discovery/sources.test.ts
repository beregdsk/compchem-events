import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { loadSources, SOURCE_KINDS, validateSources } from '../../src/lib/discovery/sources';

describe('loadSources', () => {
  it('parses valid entries and skips malformed ones', () => {
    const sources = loadSources('tests/discovery/fixtures/sources/sample.yaml');
    expect(sources).toHaveLength(3);
    expect(sources[0]).toEqual({
      name: 'Good Listing',
      url: 'https://example.org/events',
      kind: 'listing-page',
      added: '2026-09-23',
      last_checked: '2026-09-23',
      notes: 'A sample listing page.',
    });
    expect(sources[1]!.kind).toBe('rss');
  });

  it('accepts an optional folder field, meaningful only for kind: mailbox', () => {
    const sources = loadSources('tests/discovery/fixtures/sources/sample.yaml');
    const mailbox = sources.find((s) => s.kind === 'mailbox');
    expect(mailbox).toEqual({
      name: 'Good Mailbox',
      url: 'https://example.org/mailing-list',
      kind: 'mailbox',
      folder: 'Announcements',
    });
  });

  it('rejects an entry whose folder is not a string', () => {
    const sources = loadSources('tests/discovery/fixtures/sources/bad-folder.yaml');
    expect(sources).toHaveLength(0);
  });

  it('loads the real data/sources.yaml with every entry a known kind', () => {
    const sources = loadSources();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(SOURCE_KINDS).toContain(s.kind);
      expect(s.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('validateSources', () => {
  const good = {
    name: 'Good',
    url: 'https://example.org/events',
    kind: 'listing-page',
    added: '2026-09-23',
    last_checked: '2026-09-23',
    notes: 'n',
  };
  const fields = (data: unknown) => validateSources(data).map((p) => p.field);

  it('passes the real data/sources.yaml', () => {
    expect(validateSources(parse(readFileSync('data/sources.yaml', 'utf8')))).toEqual([]);
  });

  it('passes a well-formed entry', () => {
    expect(validateSources([good])).toEqual([]);
  });

  it('rejects a file that is not a list', () => {
    expect(fields({ name: 'x' })).toEqual(['(root)']);
  });

  it('rejects an unknown kind, a non-https url and a missing last_checked', () => {
    const { last_checked, ...rest } = good;
    void last_checked;
    expect(fields([{ ...rest, kind: 'website', url: 'http://example.org/' }])).toEqual([
      '0/kind',
      '0/url',
      '0/last_checked',
    ]);
  });

  it('rejects a misspelt field, which loadSources would silently ignore', () => {
    expect(fields([{ ...good, last_check: '2026-09-23' }])).toEqual(['0/last_check']);
  });

  it('rejects an impossible date', () => {
    expect(fields([{ ...good, added: '2026-02-30' }])).toEqual(['0/added']);
  });

  it('rejects a repeated url', () => {
    expect(fields([good, { ...good, name: 'Again' }])).toEqual(['1/url']);
  });

  it('allows folder only on kind: mailbox', () => {
    expect(fields([{ ...good, folder: 'x' }])).toEqual(['0/folder']);
    expect(fields([{ ...good, kind: 'mailbox', folder: 'x' }])).toEqual([]);
  });
});

it.each(['aggregator', 'group-listing'])('accepts kind %s', (kind) => {
  expect(
    validateSources([{ name: 'X', url: 'https://x.example/', kind, last_checked: '2026-09-29' }]),
  ).toEqual([]);
});
