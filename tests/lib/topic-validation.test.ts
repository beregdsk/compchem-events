import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateTopics } from '../../src/lib/topic-validation';

const msgs = (data: unknown) => {
  const r = validateTopics(data);
  return {
    errors: r.errors.map((e) => `${e.field}: ${e.message}`),
    warnings: r.warnings.map((w) => `${w.field}: ${w.message}`),
  };
};

describe('validateTopics', () => {
  it('accepts the real vocabulary', () => {
    expect(msgs(parse(readFileSync('data/topics.yaml', 'utf8'))).errors).toEqual([]);
  });

  it('accepts openalex ids and rejects malformed or repeated ones', () => {
    expect(msgs([{ slug: 'dft', label: 'DFT', openalex: ['T123', 'T45'] }]).errors).toEqual([]);
    expect(msgs([{ slug: 'dft', label: 'DFT', openalex: ['123'] }]).errors).toEqual([
      'dft.openalex: "123" is not an OpenAlex topic id (T followed by digits)',
    ]);
    expect(msgs([{ slug: 'dft', label: 'DFT', openalex: ['T1', 'T1'] }]).errors).toEqual([
      'dft.openalex: "T1" is listed twice',
    ]);
  });

  it('rejects a repeated slug, a bad slug and a missing label', () => {
    expect(
      msgs([
        { slug: 'dft', label: 'A' },
        { slug: 'dft', label: 'B' },
        { slug: 'Bad Slug', label: 'C' },
        { slug: 'x' },
      ]).errors,
    ).toEqual([
      'dft.slug: repeated slug',
      'Bad Slug.slug: must be lowercase words joined by hyphens',
      'x.label: required',
    ]);
  });

  it('warns, but allows, one OpenAlex topic under two slugs', () => {
    const r = msgs([
      { slug: 'a', label: 'A', openalex: ['T9'] },
      { slug: 'b', label: 'B', openalex: ['T9'] },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['b.openalex: "T9" is also mapped under "a"']);
  });

  it('rejects a file that is not a list', () => {
    expect(msgs({ slug: 'x' }).errors).toEqual(['(root): must be a list of topics']);
  });
});
