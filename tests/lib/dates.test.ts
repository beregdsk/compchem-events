import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareISO,
  daysBetween,
  parseISODate,
  todayUTC,
  toISODate,
} from '../../src/lib/dates';

describe('parseISODate', () => {
  it('parses a date as UTC midnight', () => {
    expect(parseISODate('2026-03-08')).toBe(Date.UTC(2026, 2, 8));
  });

  it('rejects a malformed string', () => {
    expect(() => parseISODate('08/03/2026')).toThrow(RangeError);
  });

  it('rejects a date that does not exist', () => {
    expect(() => parseISODate('2026-02-30')).toThrow(RangeError);
  });

  it('accepts a real leap day', () => {
    expect(toISODate(parseISODate('2028-02-29'))).toBe('2028-02-29');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses a leap-year boundary', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('subtracts', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('daysBetween', () => {
  it('counts forward', () => {
    expect(daysBetween('2026-03-01', '2026-03-11')).toBe(10);
  });

  it('is negative backwards', () => {
    expect(daysBetween('2026-03-11', '2026-03-01')).toBe(-10);
  });

  it('is zero for the same day', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('compareISO', () => {
  it('sorts ascending', () => {
    const input = ['2027-01-05', '2026-12-31', '2027-01-04'];
    expect([...input].sort(compareISO)).toEqual(['2026-12-31', '2027-01-04', '2027-01-05']);
  });
});

describe('todayUTC', () => {
  it('uses the UTC calendar day, not the local one', () => {
    // 23:30 UTC on 1 March is already 2 March in Sydney and still 1 March in UTC.
    expect(todayUTC(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
  });

  it('handles the first instant of a day', () => {
    expect(todayUTC(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03-02');
  });
});
