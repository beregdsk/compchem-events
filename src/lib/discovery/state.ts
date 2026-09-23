import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HostState {
  robotsTxt?: string;
  lastRequestAt?: string;
}

export interface PageState {
  etag?: string;
  contentHash?: string;
  fetchedAt: string;
}

export interface DiscoveryState {
  hosts: Record<string, HostState>;
  pages: Record<string, PageState>;
}

export function emptyState(): DiscoveryState {
  return { hosts: {}, pages: {} };
}

function isDiscoveryState(data: unknown): data is DiscoveryState {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as DiscoveryState).hosts === 'object' &&
    typeof (data as DiscoveryState).pages === 'object'
  );
}

/** Never throws: a missing or corrupt state file just starts a run from scratch. */
export function loadState(path: string): DiscoveryState {
  if (!existsSync(path)) return emptyState();
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isDiscoveryState(data) ? data : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, state: DiscoveryState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
