import { describe, expect, it } from 'vitest';
import { compareSortKeys } from '../../src/lib/sort-keys';

const order = (keys: string[], ascending: boolean) =>
  [...keys].sort((a, b) => compareSortKeys(a, b, ascending));

describe('compareSortKeys', () => {
  it('sorts numbers numerically and keeps empty keys last in both directions', () => {
    expect(order(['10', '', '9', '100'], false)).toEqual(['100', '10', '9', '']);
    expect(order(['10', '', '9', '100'], true)).toEqual(['9', '10', '100', '']);
  });

  it('sorts text alphabetically', () => {
    expect(order(['b', 'a', ''], true)).toEqual(['a', 'b', '']);
  });
});
