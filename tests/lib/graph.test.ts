import { describe, expect, it } from 'vitest';
import { shortLabel } from '../../src/lib/graph';

describe('shortLabel', () => {
  it('leaves a short title alone', () => {
    expect(shortLabel('Sanibel Symposium')).toBe('Sanibel Symposium');
  });

  it('truncates to the limit with an ellipsis', () => {
    const label = shortLabel('Total Energy and Force Methods Workshop 2027');
    expect([...label]).toHaveLength(28);
    expect(label.endsWith('…')).toBe(true);
  });

  it('counts code points, never splitting a surrogate pair', () => {
    const label = shortLabel('🧪'.repeat(40), 10);
    expect([...label]).toHaveLength(10);
    expect(label).toBe('🧪'.repeat(9) + '…');
  });
});
