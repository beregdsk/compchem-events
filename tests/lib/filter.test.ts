import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  isEmptyFilter,
  matchesFilter,
  parseFilterState,
  rowFromDataset,
  serialiseFilterState,
  type FilterRow,
} from '../../src/lib/filter';

const row: FilterRow = {
  search: 'excited-state methods example institute exampleville',
  topics: ['excited-states', 'dft'],
  region: 'Europe',
  country: 'NL',
  format: 'in-person',
  type: 'workshop',
  start: '2027-03-08',
  end: '2027-03-10',
  openDeadline: true,
};

describe('parseFilterState', () => {
  it('reads every parameter', () => {
    const s = parseFilterState(
      new URLSearchParams(
        'q=dft&topics=dft,catalysis&region=Europe&country=DE&format=hybrid&type=school&from=2027-01-01&to=2027-12-31&deadline=open',
      ),
    );
    expect(s).toEqual({
      q: 'dft',
      topics: ['dft', 'catalysis'],
      region: 'Europe',
      country: 'DE',
      format: 'hybrid',
      type: 'school',
      from: '2027-01-01',
      to: '2027-12-31',
      deadline: true,
    });
  });

  it('returns the empty state for no parameters', () => {
    expect(parseFilterState(new URLSearchParams())).toEqual(EMPTY_FILTER);
  });

  it('drops empty topic entries', () => {
    expect(parseFilterState(new URLSearchParams('topics=,dft,')).topics).toEqual(['dft']);
  });
});

describe('serialiseFilterState', () => {
  it('omits empty values so a clean view stays at /', () => {
    expect(serialiseFilterState(EMPTY_FILTER).toString()).toBe('');
  });

  it('round-trips', () => {
    const s = parseFilterState(new URLSearchParams('q=dft&topics=dft,catalysis&deadline=open'));
    expect(parseFilterState(serialiseFilterState(s))).toEqual(s);
  });

  it('writes topics as a comma-separated list', () => {
    const params = serialiseFilterState({ ...EMPTY_FILTER, topics: ['dft', 'catalysis'] });
    expect(params.get('topics')).toBe('dft,catalysis');
  });
});

describe('isEmptyFilter', () => {
  it('is true for the empty state', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
  });

  it('is false once anything is set', () => {
    expect(isEmptyFilter({ ...EMPTY_FILTER, deadline: true })).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('matches everything when nothing is set', () => {
    expect(matchesFilter(row, EMPTY_FILTER)).toBe(true);
  });

  it('matches free text case-insensitively', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, q: 'EXAMPLE' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, q: 'catalysis' })).toBe(false);
  });

  it('ORs within topics', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['catalysis', 'dft'] })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['catalysis'] })).toBe(false);
  });

  it('ANDs across categories', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['dft'], format: 'in-person' })).toBe(
      true,
    );
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['dft'], format: 'online' })).toBe(false);
  });

  it('filters by region, country and type', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, region: 'Europe' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, region: 'Asia' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, country: 'NL' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, country: 'DE' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, type: 'workshop' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, type: 'school' })).toBe(false);
  });

  it('treats the date range as an overlap', () => {
    // Window ends before the event starts.
    expect(matchesFilter(row, { ...EMPTY_FILTER, to: '2027-03-07' })).toBe(false);
    // Window starts after the event ends.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-03-11' })).toBe(false);
    // Window clips the event's first day.
    expect(matchesFilter(row, { ...EMPTY_FILTER, to: '2027-03-08' })).toBe(true);
    // Window clips the event's last day.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-03-10' })).toBe(true);
    // Window fully contains the event.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-01-01', to: '2027-12-31' })).toBe(
      true,
    );
  });

  it('filters by open deadline', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, deadline: true })).toBe(true);
    expect(
      matchesFilter({ ...row, openDeadline: false }, { ...EMPTY_FILTER, deadline: true }),
    ).toBe(false);
  });
});

describe('rowFromDataset', () => {
  it('reads the data attributes the server renders', () => {
    const parsed = rowFromDataset({
      search: 'Some Title',
      topics: 'dft catalysis',
      region: 'Europe',
      country: 'DE',
      format: 'hybrid',
      type: 'school',
      start: '2027-01-01',
      end: '2027-01-03',
      deadline: 'open',
    });
    expect(parsed.topics).toEqual(['dft', 'catalysis']);
    expect(parsed.openDeadline).toBe(true);
    expect(parsed.search).toBe('some title');
  });

  it('tolerates missing attributes', () => {
    const parsed = rowFromDataset({});
    expect(parsed.topics).toEqual([]);
    expect(parsed.openDeadline).toBe(false);
  });
});
