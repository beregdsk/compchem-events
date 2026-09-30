import { describe, expect, it } from 'vitest';
import { ruleSlugs, type CandidateTopic } from '../../src/lib/topics/map-rules';

const t = (name: string, keywords: string[] = [], description = ''): CandidateTopic => ({
  id: 'T1',
  name,
  description,
  keywords,
  subfield: 'Physical and Theoretical Chemistry',
  works: 1,
});
const ALL = new Set(['dft', 'molecular-dynamics', 'ml-potentials', 'excited-states', 'catalysis']);

describe('ruleSlugs', () => {
  it.each([
    [t('Density Functional Theory Applications'), ['dft']],
    [t('Protein folding', ['Molecular Dynamics']), ['molecular-dynamics']],
    [t('Machine Learning in Materials Science', ['Interatomic Potentials']), ['ml-potentials']],
    [t('Machine Learning in Healthcare'), []],
    [t('Organic synthesis methods'), []],
  ])('%o', (topic, expected) => expect(ruleSlugs(topic, ALL)).toEqual(expected));

  it('never returns a slug that is not in the vocabulary', () => {
    expect(ruleSlugs(t('Density Functional Theory'), new Set(['catalysis']))).toEqual([]);
  });
});
