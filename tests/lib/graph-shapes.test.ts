import { describe, expect, it } from 'vitest';
import { shapeFor, shapePath } from '../../src/lib/graph-shapes';
import { EVENT_TYPES } from '../../src/lib/types';

describe('graph shapes', () => {
  it('gives every event type a shape', () => {
    for (const type of EVENT_TYPES) expect(shapeFor(type)).toBeTruthy();
  });

  it("draws the spec's mapping", () => {
    expect(EVENT_TYPES.map((t) => [t, shapeFor(t)])).toEqual([
      ['conference', 'circle'],
      ['workshop', 'square'],
      ['school', 'diamond'],
      ['symposium', 'triangle'],
      ['webinar', 'ring'],
      ['hackathon', 'ring'],
    ]);
  });

  it('returns a closed path for each shape', () => {
    for (const s of ['circle', 'square', 'diamond', 'triangle', 'ring'] as const) {
      expect(shapePath(s)).toMatch(/^M.*Z$/);
    }
  });
});
