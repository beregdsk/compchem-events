import { describe, expect, it } from 'vitest';
import { atomFeed } from '../../src/pages/feed.xml';
import { eventsExport } from '../../src/pages/events.json';
import { loadEvents } from '../../src/lib/events';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };
const events = loadEvents(opts);
const at = new Date('2026-09-20T06:00:00Z');

describe('atomFeed', () => {
  const feed = atomFeed(events, at);

  it('is well-formed XML', () => {
    // No unescaped raw ampersands outside entities.
    expect(/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(feed)).toBe(false);
    expect(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(feed.trimEnd().endsWith('</feed>')).toBe(true);
  });

  it('has one entry per event', () => {
    expect(feed.match(/<entry>/g) ?? []).toHaveLength(events.length);
  });

  it('carries a self link and a feed id', () => {
    expect(feed).toContain('rel="self"');
    expect(feed).toContain('<id>https://placeholder.example/</id>');
  });

  it('carries a feed-level author (RFC 4287 §4.1.1)', () => {
    expect(feed).toContain('<author>');
    expect(feed).toContain('<name>CompChem Events</name>');
  });

  it('timestamps entries from the added date', () => {
    expect(feed).toContain('<updated>2026-09-20T00:00:00Z</updated>');
  });

  it('escapes special characters in titles', () => {
    const escaped = atomFeed([{ ...events[0]!, title: 'A & B <tag> "quoted"' }], at);
    expect(escaped).toContain('A &amp; B &lt;tag&gt; &quot;quoted&quot;');
  });
});

describe('eventsExport', () => {
  const data = eventsExport(events, at) as {
    schema_version: number;
    generated_at: string;
    count: number;
    events: Record<string, unknown>[];
  };

  it('declares schema_version 1', () => {
    expect(data.schema_version).toBe(1);
  });

  it('reports a generated_at timestamp and a matching count', () => {
    expect(data.generated_at).toBe('2026-09-20T06:00:00Z');
    expect(data.count).toBe(data.events.length);
  });

  it('includes the derived region and status fields', () => {
    for (const e of data.events) {
      expect(e.region).toBeDefined();
      expect(e.status_derived).toBeDefined();
    }
  });

  it('does not leak the internal fixture flag', () => {
    for (const e of data.events) expect('fixture' in e).toBe(false);
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(JSON.stringify(data))).not.toThrow();
  });
});
