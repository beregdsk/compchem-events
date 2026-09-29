import { describe, expect, it } from 'vitest';
import { groupFilePath, synthesizeGroupDraft } from '../../src/lib/discovery/group-draft';

const fields = {
  name: 'Laboratory of Computational Science and Modeling',
  kind: 'group' as const,
  pi: 'Michele Ceriotti',
  location: { city: 'Lausanne', country: 'CH' },
  topics: ['ml-potentials'],
  description: 'x',
  confidence: 0.9,
};

describe('synthesizeGroupDraft', () => {
  it('slugs the name into the id and keeps the matched text as an alias', () => {
    const d = synthesizeGroupDraft(
      fields,
      'https://www.epfl.ch/labs/cosmo/',
      'COSMO lab',
      new Set(),
      '2026-09-29',
    );
    expect(d).toMatchObject({
      id: 'laboratory-of-computational-science-and-modeling',
      aliases: ['COSMO lab'],
      website: 'https://www.epfl.ch/labs/cosmo/',
      added: '2026-09-29',
    });
    expect(groupFilePath(d)).toBe(
      'data/groups/laboratory-of-computational-science-and-modeling.yaml',
    );
  });

  it('adds no alias when the matched text is the name or the PI', () => {
    expect(
      synthesizeGroupDraft(
        fields,
        'https://a.example/',
        'Michele Ceriotti',
        new Set(),
        '2026-09-29',
      ).aliases,
    ).toBeUndefined();
  });

  it('suffixes a taken id', () => {
    const taken = new Set(['laboratory-of-computational-science-and-modeling']);
    expect(synthesizeGroupDraft(fields, 'https://a.example/', 'x', taken, '2026-09-29').id).toBe(
      'laboratory-of-computational-science-and-modeling-2',
    );
  });
});
