import { describe, expect, it } from 'vitest';
import { keywordTopics } from '../../src/lib/discovery/keyword-topics';
import { loadTopics } from '../../src/lib/validation';

const vocabulary = loadTopics();

describe('keywordTopics', () => {
  it('matches labels and slugs as phrases, hyphens and case ignored', () => {
    expect(keywordTopics('Time-Dependent Density-Functional Theory school', vocabulary)).toEqual([
      'dft',
    ]);
    expect(keywordTopics('MOLECULAR DYNAMICS and Enhanced Sampling', vocabulary)).toEqual([
      'molecular-dynamics',
      'enhanced-sampling',
    ]);
  });

  it('lets a phrase run into digits but not into letters', () => {
    expect(keywordTopics('DFT2026 Donostia', vocabulary)).toEqual(['dft']);
    expect(keywordTopics('Catalysis-free rheology; spectroscopyx', vocabulary)).toEqual([
      'catalysis',
    ]);
  });

  it('returns nothing for text off the vocabulary', () => {
    expect(keywordTopics('Iberian Meeting on Rheology', vocabulary)).toEqual([]);
  });

  it('caps at the schema maximum of five topics', () => {
    const everything = vocabulary.map((t) => t.label).join(', ');
    expect(keywordTopics(everything, vocabulary)).toHaveLength(5);
  });
});
