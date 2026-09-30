import { describe, expect, it } from 'vitest';
import { barGeometry, sparklinePoints } from '../../src/lib/charts';

describe('barGeometry', () => {
  it('scales the tallest bar to the full height, bottom-aligned', () => {
    const { bars, max } = barGeometry(
      [
        { label: '2024', value: 5 },
        { label: '2025', value: 10 },
      ],
      100,
      50,
      2,
    );
    expect(max).toBe(10);
    expect(bars[1]).toMatchObject({ height: 50, y: 0, value: 10 });
    expect(bars[0]).toMatchObject({ height: 25, y: 25 });
    expect(bars[0]!.width).toBe(48);
    expect(bars[1]!.x).toBe(51);
  });

  it('draws nothing tall for an all-zero or empty series', () => {
    expect(barGeometry([{ label: 'a', value: 0 }], 100, 50).bars[0]!.height).toBe(0);
    expect(barGeometry([], 100, 50)).toEqual({ bars: [], max: 0 });
  });
});

describe('sparklinePoints', () => {
  it('maps a series across the width, highest at the top', () => {
    expect(sparklinePoints([0, 5, 10], 80, 20)).toBe('0,20 40,10 80,0');
  });
  it('draws a flat series along the middle and nothing for fewer than two points', () => {
    expect(sparklinePoints([3, 3], 10, 20)).toBe('0,10 10,10');
    expect(sparklinePoints([1], 10, 20)).toBe('');
  });
});
