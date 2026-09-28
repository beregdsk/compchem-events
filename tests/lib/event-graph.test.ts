import { describe, expect, it } from 'vitest';
import { organizerKeys, shortLabel, similarity } from '../../src/lib/event-graph';

describe('organizerKeys', () => {
  it('reduces every CECAM node to the same key', () => {
    for (const name of [
      'CECAM',
      'CECAM-IT-SISSA',
      'CECAM Beijing node',
      'CECAM-NL and the University of Amsterdam',
    ]) {
      expect(organizerKeys(name).has('cecam')).toBe(true);
    }
  });

  it('ignores two-letter country codes', () => {
    expect(organizerKeys('CECAM-IT-SISSA')).toEqual(new Set(['cecam', 'sissa']));
  });

  it('splits co-organizers on semicolons', () => {
    expect(organizerKeys('CCP5; RSC Statistical Mechanics & Thermodynamics Group')).toEqual(
      new Set(['ccp5', 'rsc']),
    );
  });

  it('finds a mixed-case acronym in parentheses', () => {
    expect(organizerKeys('Molecular Sciences Software Institute (MolSSI)')).toEqual(
      new Set(['molssi']),
    );
  });

  it('falls back to the whole part when it has no acronym', () => {
    expect(organizerKeys('Telluride Science')).toEqual(new Set(['telluride science']));
  });

  it('is empty for a missing organizer', () => {
    expect(organizerKeys(undefined).size).toBe(0);
  });
});

describe('similarity', () => {
  const base = { topics: ['dft', 'excited-states'], series: undefined, organizer: undefined };

  it('scores identical topics alone at the topic weight', () => {
    expect(similarity(base, { ...base })).toBeCloseTo(0.6);
  });

  it('scores a shared series alone at the series weight', () => {
    expect(
      similarity(
        { topics: ['dft'], series: 'molsim' },
        { topics: ['catalysis'], series: 'molsim' },
      ),
    ).toBeCloseTo(0.25);
  });

  it('scores a shared organizer alone at the organizer weight', () => {
    expect(
      similarity(
        { topics: ['dft'], organizer: 'CECAM-IT-SISSA' },
        { topics: ['catalysis'], organizer: 'CECAM Beijing node' },
      ),
    ).toBeCloseTo(0.15);
  });

  it('is symmetric', () => {
    const a = { topics: ['dft', 'catalysis'], organizer: 'CCP5' };
    const b = { topics: ['dft'], organizer: 'CCP5; RSC Group' };
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a));
  });

  it('never exceeds 1', () => {
    const e = { topics: ['dft'], series: 's', organizer: 'CECAM' };
    expect(similarity(e, { ...e })).toBeLessThanOrEqual(1);
  });

  it('treats duplicate topics as a set', () => {
    expect(similarity({ topics: ['dft', 'dft'] }, { topics: ['dft'] })).toBeCloseTo(0.6);
  });

  it('is 0, not NaN, for two events with no topics', () => {
    expect(similarity({ topics: [] }, { topics: [] })).toBe(0);
  });
});

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
