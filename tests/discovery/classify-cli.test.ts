import { describe, expect, it } from 'vitest';
import { readCandidate } from '../../scripts/discovery/classify';

describe('readCandidate', () => {
  it('parses a YAML candidate file', () => {
    const candidate = readCandidate('tests/discovery/fixtures/candidates/clean-add.yaml');
    expect(candidate.title).toBe('New Symposium on Excited-State Photochemistry');
    expect(candidate.topics).toEqual(['photochemistry', 'excited-states']);
  });

  it('parses a JSON candidate file', () => {
    const candidate = readCandidate('tests/discovery/fixtures/candidates/clean-add.json');
    expect(candidate.title).toBe('New Symposium on Excited-State Photochemistry');
    expect(candidate.url).toBe('https://organiser.example.org/excited-states-symposium-2027/');
  });
});
