import { describe, expect, it } from 'vitest';
import { inferEventType, parseICalFeed } from '../../../src/lib/discovery/parsers/ical';

describe('inferEventType', () => {
  it('matches known type keywords', () => {
    expect(inferEventType('Annual Conference on Simulation')).toBe('conference');
    expect(inferEventType('DFT Summer School')).toBe('school');
    expect(inferEventType('Excited States Symposium')).toBe('symposium');
    expect(inferEventType('Free Webinar Series')).toBe('webinar');
    expect(inferEventType('Data Hackathon')).toBe('hackathon');
  });

  it('defaults to workshop when nothing matches', () => {
    expect(inferEventType('Advanced Methods in Chemistry')).toBe('workshop');
  });
});

const onlineFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:online-1@example.org
DTSTART;VALUE=DATE:20270301
DTEND;VALUE=DATE:20270303
SUMMARY:Online Workshop on Simulation
DESCRIPTION:A short online workshop.
URL:https://example.org/online-workshop
END:VEVENT
END:VCALENDAR`;

const inPersonNoCityFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:in-person-1@example.org
DTSTART;VALUE=DATE:20270601
DTEND;VALUE=DATE:20270602
SUMMARY:One-Day In-Person Conference
LOCATION:Somewhere Nice
END:VEVENT
END:VCALENDAR`;

describe('parseICalFeed', () => {
  it('maps an online VEVENT with no LOCATION to format online and end_date inclusive', () => {
    const drafts = parseICalFeed(onlineFeed, 'https://example.org/calendar.ics', '2026-09-23');
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.title).toBe('Online Workshop on Simulation');
    expect(draft.type).toBe('workshop');
    expect(draft.format).toBe('online');
    expect(draft.start_date).toBe('2027-03-01');
    expect(draft.end_date).toBe('2027-03-02');
    expect(draft.url).toBe('https://example.org/online-workshop');
    expect(draft.source_url).toBe('https://example.org/calendar.ics');
    expect(draft.topics).toEqual([]);
    expect('location' in draft).toBe(false);
  });

  it('marks in-person when LOCATION is present, but leaves location unset without a parseable city/country', () => {
    const drafts = parseICalFeed(
      inPersonNoCityFeed,
      'https://example.org/calendar.ics',
      '2026-09-23',
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.format).toBe('in-person');
    expect('location' in drafts[0]!).toBe(false);
    expect(drafts[0]!.type).toBe('conference');
  });

  it('returns an empty array for an empty calendar', () => {
    const empty = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//Test//EN\nEND:VCALENDAR';
    expect(parseICalFeed(empty, 'https://example.org/calendar.ics', '2026-09-23')).toEqual([]);
  });

  it('returns an empty array for unparseable text rather than throwing', () => {
    expect(
      parseICalFeed('not an ics file', 'https://example.org/calendar.ics', '2026-09-23'),
    ).toEqual([]);
  });
});
