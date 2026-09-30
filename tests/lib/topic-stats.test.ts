import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTopicStats, validateTopicStats } from '../../src/lib/topic-stats';
import type { Topic } from '../../src/lib/types';

const fixture = () => JSON.parse(readFileSync('tests/fixtures/topic-stats/valid.json', 'utf8'));
const topics: Topic[] = [{ slug: 'ml-potentials', label: 'ML potentials', openalex: ['T11948'] }];
const run = (data: unknown, t: readonly Topic[] = topics) => {
  const r = validateTopicStats(data, t);
  return {
    errors: r.errors.map((e) => `${e.field}: ${e.message}`),
    warnings: r.warnings.map((w) => `${w.field}: ${w.message}`),
  };
};

describe('validateTopicStats', () => {
  it('accepts the fixture', () => expect(run(fixture())).toEqual({ errors: [], warnings: [] }));

  it('rejects an unknown slug, an http link and a gap in the years', () => {
    const d = fixture();
    d.topics['not-a-topic'] = d.topics['ml-potentials'];
    d.topics['ml-potentials'].top_papers[0].doi = 'http://doi.org/10.1/x';
    d.topics['ml-potentials'].works_by_year[1].year = 2030;
    expect(run(d).errors).toEqual([
      'topics.ml-potentials.top_papers[0].doi: must be an https URL',
      'topics.ml-potentials.works_by_year: years must be consecutive, oldest first',
      'topics.not-a-topic: not a slug in data/topics.yaml',
    ]);
  });

  it('fails the schema on a wrong shape', () => {
    const d = fixture();
    d.topics['ml-potentials'].works_total = 'many';
    expect(run(d).errors[0]).toMatch(/^\/topics\/ml-potentials\/works_total: must be integer/);
  });

  it('only warns when the mapping changed after the snapshot', () => {
    const r = run(fixture(), [{ slug: 'ml-potentials', label: 'x', openalex: ['T11948', 'T5'] }]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      'topics.ml-potentials.openalex: snapshot predates the current mapping; the next monthly snapshot updates it',
    ]);
  });

  it('accepts a null growth', () => {
    const d = fixture();
    d.topics['ml-potentials'].growth_5y = null;
    expect(run(d).errors).toEqual([]);
  });
});

describe('loadTopicStats', () => {
  it('returns undefined when the file does not exist', () => {
    expect(loadTopicStats(mkdtempSync(join(tmpdir(), 'ts-')))).toBeUndefined();
  });

  it('reads a valid file and throws on an invalid one', () => {
    const root = mkdtempSync(join(tmpdir(), 'ts-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(
      join(root, 'data/topics.yaml'),
      '- slug: ml-potentials\n  label: ML\n  openalex: [T11948]\n',
    );
    writeFileSync(join(root, 'data/topic-stats.json'), JSON.stringify(fixture()));
    expect(loadTopicStats(root)?.topics['ml-potentials']?.works_total).toBe(120409);
    writeFileSync(join(root, 'data/topic-stats.json'), '{"schema_version": 2}');
    expect(() => loadTopicStats(root)).toThrow(/topic statistics are invalid/);
  });
});
