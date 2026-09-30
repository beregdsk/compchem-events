import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState, loadState, mergeGroupLookups, saveState } from '../../src/lib/discovery/state';

const dirs: string[] = [];
function tmpPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-state-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('emptyState', () => {
  it('has empty hosts, pages, groupLookups and rejectedPrs maps', () => {
    expect(emptyState()).toEqual({ hosts: {}, pages: {}, groupLookups: {}, rejectedPrs: {} });
  });
});

describe('loadState', () => {
  it('adds empty groupLookups and rejectedPrs maps to an older state file', () => {
    const path = tmpPath('old.json');
    writeFileSync(path, JSON.stringify({ hosts: {}, pages: {} }));
    expect(loadState(path).groupLookups).toEqual({});
    expect(loadState(path).rejectedPrs).toEqual({});
  });

  it('returns an empty state when the file does not exist', () => {
    expect(loadState(tmpPath('nested/state.json'))).toEqual(emptyState());
  });

  it('returns an empty state when the file is not valid JSON', () => {
    const path = tmpPath('state.json');
    writeFileSync(path, 'not json');
    expect(loadState(path)).toEqual(emptyState());
  });

  it('returns an empty state when the JSON is missing hosts or pages', () => {
    const path = tmpPath('state.json');
    writeFileSync(path, JSON.stringify({ hosts: {} }));
    expect(loadState(path)).toEqual(emptyState());
  });
});

describe('saveState / loadState round trip', () => {
  it('creates parent directories and round-trips the state', () => {
    const path = tmpPath('nested/deep/state.json');
    const state = {
      hosts: {
        'example.org': { robotsTxt: 'User-agent: *\n', lastRequestAt: '2026-09-23T00:00:00.000Z' },
      },
      pages: {
        'https://example.org/a': {
          etag: 'W/"x"',
          contentHash: 'abc',
          fetchedAt: '2026-09-23T00:00:00.000Z',
        },
      },
      groupLookups: {
        'some group': { triedAt: '2026-09-23T00:00:00.000Z', outcome: 'no-homepage' },
      },
      rejectedPrs: {
        '108': { files: [{ path: 'data/events/2026/x.yaml', data: { title: 'X' } }] },
      },
    };
    saveState(path, state);
    expect(loadState(path)).toEqual(state);
  });
});

describe('saveState', () => {
  it('writes atomically, leaving no temp file behind', () => {
    const path = tmpPath('atomic/state.json');
    saveState(path, emptyState());
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(loadState(path)).toEqual(emptyState());
  });
});

describe('mergeGroupLookups', () => {
  const at = (d: string, outcome = 'not found') => ({ triedAt: `${d}T00:00:00.000Z`, outcome });

  it('applies only what this process changed onto the file as it is now', () => {
    const path = tmpPath('merge/state.json');
    const before = { kept: at('2026-09-01'), forgotten: at('2026-09-01') };
    // Another process wrote its own entry and some pages meanwhile.
    saveState(path, {
      ...emptyState(),
      pages: { 'https://x/': { fetchedAt: '2026-10-01T00:00:00.000Z' } },
      groupLookups: { ...before, theirs: at('2026-10-01') },
    });
    const after = { kept: at('2026-09-01'), mine: at('2026-10-01', 'drafted') };
    mergeGroupLookups(path, before, after);
    const s = loadState(path);
    expect(s.groupLookups).toEqual({
      kept: at('2026-09-01'),
      theirs: at('2026-10-01'),
      mine: at('2026-10-01', 'drafted'),
    });
    expect(s.pages).toEqual({ 'https://x/': { fetchedAt: '2026-10-01T00:00:00.000Z' } });
  });

  it('does not delete an entry another process has since rewritten', () => {
    const path = tmpPath('merge2/state.json');
    const before = { k: at('2026-09-01') };
    saveState(path, { ...emptyState(), groupLookups: { k: at('2026-10-02', 'drafted') } });
    mergeGroupLookups(path, before, {});
    expect(loadState(path).groupLookups).toEqual({ k: at('2026-10-02', 'drafted') });
  });
});
