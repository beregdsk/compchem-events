import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyState, loadState, saveState } from '../../src/lib/discovery/state';

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
  it('has empty hosts, pages and groupLookups maps', () => {
    expect(emptyState()).toEqual({ hosts: {}, pages: {}, groupLookups: {} });
  });
});

describe('loadState', () => {
  it('adds an empty groupLookups map to an older state file', () => {
    const path = tmpPath('old.json');
    writeFileSync(path, JSON.stringify({ hosts: {}, pages: {} }));
    expect(loadState(path).groupLookups).toEqual({});
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
    };
    saveState(path, state);
    expect(loadState(path)).toEqual(state);
  });
});
