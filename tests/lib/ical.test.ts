import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { buildCalendar, escapeText, foldLine, icalDate } from '../../src/lib/ical';

const stamp = new Date('2026-09-20T06:00:00Z');

const sample = [
  {
    uid: 'a-2027@compchem.example',
    summary: 'Workshop, with a comma; and a semicolon',
    description: 'Line one\nline two',
    start: '2027-03-08',
    end: '2027-03-10',
    url: 'https://example.org/a/',
    location: 'Exampleville, NL',
  },
  {
    uid: 'b-2027@compchem.example',
    summary: 'Cancelled Meeting',
    start: '2027-05-01',
    end: '2027-05-01',
    cancelled: true,
  },
];

describe('escapeText', () => {
  it('escapes backslashes first', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('escapes commas, semicolons and newlines', () => {
    expect(escapeText('a,b;c\nd')).toBe('a\\,b;c\\nd');
  });

  it('collapses CRLF to a single escaped newline', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'x'.repeat(200)}`);
  });

  it('never splits a multi-byte character', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const p of folded.split('\r\n')) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });
});

describe('icalDate', () => {
  it('strips the dashes', () => {
    expect(icalDate('2027-03-08')).toBe('20270308');
  });
});

describe('buildCalendar', () => {
  const ics = buildCalendar('Test Calendar', sample, stamp);

  it('uses CRLF line endings throughout', () => {
    expect(ics.includes('\n')).toBe(true);
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('sets X-WR-CALNAME', () => {
    expect(ics).toContain('X-WR-CALNAME:Test Calendar');
  });

  it('parses with a real iCalendar parser', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    expect(comp.name).toBe('vcalendar');
    expect(comp.getAllSubcomponents('vevent')).toHaveLength(2);
  });

  it('makes DTEND exclusive: the day after the last day', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = new ICAL.Event(comp.getAllSubcomponents('vevent')[0]);
    expect(first.startDate.toString()).toBe('2027-03-08');
    // Event runs 8-10 March, so DTEND is 11 March.
    expect(first.endDate.toString()).toBe('2027-03-11');
  });

  it('makes a single-day event span exactly one day', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const second = new ICAL.Event(comp.getAllSubcomponents('vevent')[1]);
    expect(second.startDate.toString()).toBe('2027-05-01');
    expect(second.endDate.toString()).toBe('2027-05-02');
  });

  it('uses all-day DATE values, not date-times', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20270308');
    expect(ics).toContain('DTEND;VALUE=DATE:20270311');
  });

  it('keeps UIDs stable and unique', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const uids = comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v).uid);
    expect(uids).toEqual(['a-2027@compchem.example', 'b-2027@compchem.example']);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('round-trips escaped text', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = new ICAL.Event(comp.getAllSubcomponents('vevent')[0]);
    expect(first.summary).toBe('Workshop, with a comma; and a semicolon');
    expect(first.description).toBe('Line one\nline two');
  });

  it('marks cancelled events', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const second = comp.getAllSubcomponents('vevent')[1]!;
    expect(second.getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('omits STATUS for events that are not cancelled', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = comp.getAllSubcomponents('vevent')[0]!;
    expect(first.getFirstPropertyValue('status')).toBe(null);
  });

  it('produces a valid empty calendar', () => {
    const empty = buildCalendar('Empty', [], stamp);
    const comp = new ICAL.Component(ICAL.parse(empty));
    expect(comp.getAllSubcomponents('vevent')).toHaveLength(0);
  });
});
