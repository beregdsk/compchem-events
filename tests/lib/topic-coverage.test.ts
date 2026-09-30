import { describe, expect, it } from 'vitest';
import { topicCoverage } from '../../src/lib/topic-coverage';

describe('topicCoverage', () => {
  it('counts upcoming events, groups and open positions carrying the topic', () => {
    const t = (topics: string[]) => ({ topics }) as never;
    expect(
      topicCoverage('dft', {
        upcoming: [t(['dft']), t(['md'])],
        groups: [t(['dft', 'md']), t(['dft'])],
        open: [t(['md'])],
      }),
    ).toEqual({ events: 1, groups: 2, positions: 0 });
  });
});
