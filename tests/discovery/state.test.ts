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
  it('has empty hosts and pages maps', () => {
    expect(emptyState()).toEqual({ hosts: {}, pages: {} });
  });
});

describe('loadState', () => {
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
    };
    saveState(path, state);
    expect(loadState(path)).toEqual(state);
  });
});
