import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HostState {
  robotsTxt?: string;
  /** When `robotsTxt` was fetched; used to treat it as stale after 24h (see `ensureRobots` in `fetch.ts`). */
  robotsFetchedAt?: string;
  lastRequestAt?: string;
}

export interface PageState {
  etag?: string;
  contentHash?: string;
  fetchedAt: string;
}

/** One groups-pass lookup: when a name was last tried, and what came of it. */
export interface GroupLookup {
  triedAt: string;
  outcome: string;
}

/** The event and position files of one PR closed without merging, parsed. */
export interface RejectedPrDrafts {
  files: Array<{ path: string; data: unknown }>;
}

export interface DiscoveryState {
  hosts: Record<string, HostState>;
  pages: Record<string, PageState>;
  /** Normalised group name → last lookup; see groups.ts's negative cache. */
  groupLookups: Record<string, GroupLookup>;
  /**
   * PR number → its drafts, read once when the PR is first seen closed
   * without merging; see pr-drafts.ts. A closed PR never changes again.
   */
  rejectedPrs: Record<string, RejectedPrDrafts>;
}

export function emptyState(): DiscoveryState {
  return { hosts: {}, pages: {}, groupLookups: {}, rejectedPrs: {} };
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
    return isDiscoveryState(data)
      ? { ...data, groupLookups: data.groupLookups ?? {}, rejectedPrs: data.rejectedPrs ?? {} }
      : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(path: string, state: DiscoveryState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
