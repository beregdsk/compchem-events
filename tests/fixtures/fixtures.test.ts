import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .map((p) => join(dir, p));
}

describe('valid fixtures', () => {
  for (const path of filesUnder('tests/fixtures/valid')) {
    it(`${path} has no errors`, () => {
      const data = parse(readFileSync(path, 'utf8'));
      const r = validateEvent({ file: path, data }, ctx);
      expect(r.errors).toEqual([]);
    });
  }
});

describe('invalid fixtures', () => {
  for (const path of filesUnder('tests/fixtures/invalid')) {
    it(`${path} reports the error named in its comment`, () => {
      const source = readFileSync(path, 'utf8');
      const expected = /^# EXPECTED ERROR: (.+)$/m.exec(source)?.[1];
      expect(expected, `${path} is missing its "# EXPECTED ERROR:" comment`).toBeDefined();

      const r = validateEvent({ file: path, data: parse(source) }, ctx);
      expect(r.errors.length, `${path} produced no errors`).toBeGreaterThan(0);

      // Match on the distinctive words of the comment, so wording can evolve
      // without the test becoming brittle.
      const haystack = r.errors
        .map((e) => `${e.field} ${e.message}`)
        .join(' ')
        .toLowerCase();
      const keywords = (expected ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);
      expect(
        keywords.some((w) => haystack.includes(w)),
        `${path}: expected "${expected}", got: ${haystack}`,
      ).toBe(true);
    });
  }
});
