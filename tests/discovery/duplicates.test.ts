import { describe, expect, it } from 'vitest';
import {
  closestEvent,
  closestPosition,
  POSSIBLE_DUPLICATE_THRESHOLD,
  wordOverlap,
  type KnownDraft,
} from '../../src/lib/discovery/duplicates';
import type { RawEvent, RawPosition } from '../../src/lib/types';

const event = (over: Partial<RawEvent>): RawEvent => ({
  id: 'e',
  title: 'An Event',
  type: 'workshop',
  start_date: '2026-10-20',
  end_date: '2026-10-20',
  format: 'online',
  url: 'https://example.org/event',
  topics: ['dft'],
  description: 'd',
  added: '2026-09-30',
  ...over,
});

const position = (over: Partial<RawPosition>): RawPosition => ({
  id: 'p',
  title: 'PhD in Computational Chemistry',
  level: 'phd',
  institution: 'Instituto de Nanociencia y Materiales de Aragón (CSIC) - Universidad de Zaragoza',
  location: { city: 'Zaragoza', country: 'ES' },
  url: 'https://t.me/quant_chem_and_stuff/668',
  source_url: 'https://t.me/quant_chem_and_stuff/668',
  topics: ['dft'],
  description: 'd',
  added: '2026-09-29',
  ...over,
});

const on = <T>(entry: T, where = '#85 (open)'): KnownDraft<T> => ({ entry, where });

describe('wordOverlap', () => {
  it.each([
    ['MOPAC User Group', 'MOPAC User Groups', 1],
    ['DL_POLY Training London', 'DL_POLY Training London, 10-11 January 2024', 1],
    ['PhD in Computational Chemistry', 'Postdoc in Computational Chemistry', 2 / 3],
  ])('%s ~ %s', (a, b, expected) => expect(wordOverlap(a, b)).toBeCloseTo(expected));

  it('needs two shared words', () => {
    expect(wordOverlap('Quantum Days', 'Quantum Materials Summit')).toBe(0);
  });
});

describe('closestEvent', () => {
  it('scores the same url as certain, and names where the match lives', () => {
    const match = closestEvent(event({ title: 'Other' }), [on(event({}))]);
    expect(match).toMatchObject({ score: 1, where: '#85 (open)', why: 'same url' });
  });

  it('flags the Discngine meetup listed twice on main (a real duplicate)', () => {
    const match = closestEvent(
      event({
        title: 'Large Language Models in Drug Discovery: From Promise to Practical Impact',
        url: 'https://server.ccl.net/chemistry/announcements/conferences/index.shtml',
      }),
      [
        on(
          event({
            title: 'Discngine Meetup Vol. 6 — Large Language Models in Drug Discovery',
            url: 'https://event.discngine.com/discngine-meetup-vol-6',
          }),
          'main',
        ),
      ],
    );
    expect(match!.score).toBeGreaterThanOrEqual(POSSIBLE_DUPLICATE_THRESHOLD);
  });

  it('does not flag unrelated titles on nearby dates', () => {
    const match = closestEvent(
      event({ title: 'Fluctuations in charged and soft matter', url: 'https://a.org/x' }),
      [on(event({ title: 'Studying dynamics in soft matter and porous materials' }))],
    );
    expect(match?.score ?? 0).toBeLessThan(POSSIBLE_DUPLICATE_THRESHOLD);
  });

  it('never matches another year’s edition', () => {
    const match = closestEvent(
      event({ title: 'CCP5 Annual General Meeting (AGM45)', url: 'https://a.org/45' }),
      [on(event({ title: 'CCP5 Annual General Meeting (AGM 43)', start_date: '2024-09-02' }))],
    );
    expect(match).toBeUndefined();
  });
});

describe('closestPosition', () => {
  it('scores the same post, title and institution as certain (PRs #105 and #110)', () => {
    const match = closestPosition(
      position({
        title: 'PhD in Computational Chemistry for Porous Organic Cages',
        institution:
          'Instituto de Nanociencia y Materiales de Aragón, CSIC, Universidad de Zaragoza',
      }),
      [on(position({}))],
    );
    expect(match!.score).toBeGreaterThanOrEqual(0.95);
    expect(match!.why).toContain('same source post');
  });

  it('flags, but does not call certain, a different post title at the same place', () => {
    const match = closestPosition(
      position({ title: 'Postdoc in Computational Chemistry', source_url: 'https://t.me/c/1' }),
      [on(position({}))],
    );
    expect(match!.score).toBeGreaterThanOrEqual(POSSIBLE_DUPLICATE_THRESHOLD);
    expect(match!.score).toBeLessThan(0.95);
  });

  it('does not flag the same title at another institution', () => {
    const match = closestPosition(
      position({ institution: 'University of Oxford', source_url: 'https://t.me/c/1' }),
      [on(position({}))],
    );
    expect(match!.score).toBeLessThan(POSSIBLE_DUPLICATE_THRESHOLD);
  });
});
