import { describe, expect, it, vi } from 'vitest';
import {
  deriveStatus,
  eventById,
  hasOpenDeadline,
  isStale,
  loadEvents,
  pastEvents,
  upcomingDeadlines,
  upcomingEvents,
} from '../../src/lib/events';
import type { RawEvent } from '../../src/lib/types';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };

const stub = (over: Partial<RawEvent>): RawEvent =>
  ({
    id: 'x-2027',
    title: 'X',
    type: 'conference',
    start_date: '2027-01-10',
    end_date: '2027-01-12',
    format: 'online',
    url: 'https://example.org/x/',
    topics: ['dft'],
    description: 'd',
    added: '2026-09-20',
    last_verified: '2026-09-20',
    ...over,
  }) as RawEvent;

describe('deriveStatus', () => {
  it('is upcoming before the start date', () => {
    expect(
      deriveStatus(stub({ start_date: '2026-10-01', end_date: '2026-10-03' }), '2026-09-20'),
    ).toBe('upcoming');
  });

  it('is ongoing on the first day', () => {
    expect(
      deriveStatus(stub({ start_date: '2026-09-20', end_date: '2026-09-22' }), '2026-09-20'),
    ).toBe('ongoing');
  });

  it('is ongoing on the last day', () => {
    expect(
      deriveStatus(stub({ start_date: '2026-09-18', end_date: '2026-09-20' }), '2026-09-20'),
    ).toBe('ongoing');
  });

  it('is past the day after it ends', () => {
    expect(
      deriveStatus(stub({ start_date: '2026-09-17', end_date: '2026-09-19' }), '2026-09-20'),
    ).toBe('past');
  });
});

describe('loadEvents', () => {
  it('loads every valid fixture', () => {
    expect(loadEvents(opts)).toHaveLength(3);
  });

  it('sorts by start date ascending', () => {
    const dates = loadEvents(opts).map((e) => e.start_date);
    expect([...dates]).toEqual([...dates].sort());
  });

  it('derives Online as the region for online events', () => {
    const e = eventById(loadEvents(opts), 'full-online-2027');
    expect(e?.region).toBe('Online');
  });

  it('derives the geographic region for located events', () => {
    const e = eventById(loadEvents(opts), 'minimal-in-person-2027');
    expect(e?.region).toBe('Europe');
  });

  it('derives the region for a hybrid event from its country', () => {
    const e = eventById(loadEvents(opts), 'cancelled-2027');
    expect(e?.region).toBe('Europe');
  });

  it('drops fixtures when includeFixtures is false', () => {
    expect(loadEvents({ ...opts, includeFixtures: false })).toHaveLength(0);
  });

  it('throws on invalid data rather than skipping it', () => {
    expect(() => loadEvents({ ...opts, eventsDir: 'tests/fixtures/invalid' })).toThrow(
      /validation failed/i,
    );
  });

  it('returns an empty list for a directory that does not exist', () => {
    expect(loadEvents({ ...opts, eventsDir: 'tests/fixtures/nope' })).toEqual([]);
  });
});

describe('selectors', () => {
  const events = loadEvents(opts);

  it('upcomingEvents excludes past events', () => {
    expect(upcomingEvents(events).every((e) => e.status_derived !== 'past')).toBe(true);
  });

  it('pastEvents is newest first', () => {
    const past = pastEvents(events);
    for (let i = 1; i < past.length; i += 1) {
      expect(past[i - 1]!.start_date >= past[i]!.start_date).toBe(true);
    }
  });

  it('upcomingDeadlines is sorted soonest first and excludes passed ones', () => {
    const ds = upcomingDeadlines(events, '2026-09-20');
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(d.deadline.date >= '2026-09-20').toBe(true);
    for (let i = 1; i < ds.length; i += 1) {
      expect(ds[i - 1]!.deadline.date <= ds[i]!.deadline.date).toBe(true);
    }
  });

  it('upcomingDeadlines excludes cancelled events', () => {
    const ds = upcomingDeadlines(events, '2026-09-20');
    expect(ds.some((d) => d.event.status === 'cancelled')).toBe(false);
  });
});

describe('hasOpenDeadline', () => {
  const events = loadEvents(opts);

  it('is true when a deadline is today or later', () => {
    const e = eventById(events, 'full-online-2027')!;
    expect(hasOpenDeadline(e, '2026-09-20')).toBe(true);
  });

  it('is false once every deadline has passed', () => {
    const e = eventById(events, 'full-online-2027')!;
    expect(hasOpenDeadline(e, '2027-05-02')).toBe(false);
  });

  it('is false for an event with no deadlines', () => {
    const e = eventById(events, 'minimal-in-person-2027')!;
    expect(hasOpenDeadline(e, '2026-09-20')).toBe(false);
  });
});

describe('isStale', () => {
  const events = loadEvents(opts);

  it('is false when recently verified', () => {
    expect(isStale(events[0]!, '2026-09-20')).toBe(false);
  });

  it('is true more than 90 days after last_verified, before the event starts', () => {
    expect(isStale(events[0]!, '2027-01-05')).toBe(true);
  });
});

describe('memoisation', () => {
  it('caches a bare loadEvents() call and returns the same array reference', () => {
    const a = loadEvents();
    const b = loadEvents();
    expect(a).toBe(b);
  });

  it('does not leak between an explicit-options call and a bare call', () => {
    // Explicit options must always bypass the cache. Assert the explicit call
    // first: if the bare-call cache (populated above, and empty because
    // data/events/ does not exist yet) leaked into it, this would see 0
    // instead of 3. Then assert the bare call still sees 0: if the explicit
    // call above had leaked *into* the cache, this would see 3 instead.
    const explicit = loadEvents(opts);
    expect(explicit).toHaveLength(3);

    const bare = loadEvents();
    expect(bare).toHaveLength(0);
  });
});

describe('warnings (do not throw)', () => {
  it('prints a warning and returns the event rather than throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let result: ReturnType<typeof loadEvents> = [];
      expect(() => {
        result = loadEvents({
          eventsDir: 'tests/fixtures/warnings',
          today: '2026-09-20',
          includeFixtures: true,
        });
      }).not.toThrow();

      expect(result).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0]!.join(' ');
      expect(message).toContain('stale-warning-2027.yaml');
      expect(message).toMatch(/90 days/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
