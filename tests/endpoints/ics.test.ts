import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { eventsCalendar } from '../../src/pages/events.ics';
import { deadlinesCalendar } from '../../src/pages/deadlines.ics';
import { loadEvents, upcomingDeadlines, upcomingEvents } from '../../src/lib/events';
import { addDays } from '../../src/lib/dates';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };
const events = loadEvents(opts);
const stamp = new Date('2026-09-20T06:00:00Z');

function vevents(ics: string) {
  return new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent');
}

describe('events.ics', () => {
  const ics = eventsCalendar(upcomingEvents(events), stamp);

  it('contains one entry per upcoming event', () => {
    expect(vevents(ics)).toHaveLength(upcomingEvents(events).length);
  });

  it('gives every entry a unique UID on the site domain', () => {
    const uids = vevents(ics).map((v) => String(new ICAL.Event(v).uid));
    expect(new Set(uids).size).toBe(uids.length);
    for (const uid of uids) expect(uid).toContain('@placeholder.example');
  });

  it('sets DTEND to exactly one day after the event’s last day', () => {
    const upcoming = upcomingEvents(events);
    const parsed = vevents(ics);
    expect(parsed).toHaveLength(upcoming.length);
    parsed.forEach((v, i) => {
      const e = new ICAL.Event(v);
      const expected = addDays(upcoming[i]!.end_date, 1);
      // Exact offset, not just "later than start" — a stray extra +1 day
      // (e.g. double-applying addDays before buildCalendar already does)
      // would still pass a merely-greater-than check. Compare the date-only
      // string rather than toJSDate().getTime(): ical.js resolves a floating
      // VALUE=DATE to local-timezone midnight, so an epoch-ms comparison
      // against a UTC-parsed value is flaky across machine timezones.
      expect(e.endDate.toString()).toBe(expected);
    });
  });

  it('marks the cancelled fixture as cancelled', () => {
    const cancelled = vevents(ics).filter((v) => v.getFirstPropertyValue('status') === 'CANCELLED');
    expect(cancelled).toHaveLength(1);
  });
});

describe('deadlines.ics', () => {
  const ics = deadlinesCalendar(events, '2026-09-20', stamp);

  it('contains one entry per open deadline', () => {
    expect(vevents(ics)).toHaveLength(upcomingDeadlines(events, '2026-09-20').length);
  });

  it('titles entries with the deadline kind', () => {
    const summaries = vevents(ics).map((v) => String(new ICAL.Event(v).summary));
    expect(summaries.some((s) => s.startsWith('[Abstract deadline] '))).toBe(true);
  });

  it('uses the id-and-type UID form', () => {
    for (const v of vevents(ics)) {
      expect(String(new ICAL.Event(v).uid)).toMatch(
        /^[a-z0-9-]+-(abstract|registration|early_bird|travel_grant|poster|application)@/,
      );
    }
  });

  it('spans exactly one day per deadline', () => {
    for (const v of vevents(ics)) {
      const e = new ICAL.Event(v);
      const days = (e.endDate.toJSDate().getTime() - e.startDate.toJSDate().getTime()) / 86_400_000;
      expect(days).toBe(1);
    }
  });

  it('names the timezone in the description', () => {
    const descriptions = vevents(ics).map((v) => String(new ICAL.Event(v).description));
    expect(descriptions.some((d) => d.includes('AoE (Anywhere on Earth)'))).toBe(true);
  });
});
