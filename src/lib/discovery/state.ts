import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** Temp file then rename: a kill mid-write never leaves a torn file (which would load as empty). */
export function saveState(path: string, state: DiscoveryState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

const sameLookup = (a: GroupLookup | undefined, b: GroupLookup | undefined) =>
  a?.triedAt === b?.triedAt && a?.outcome === b?.outcome;

/**
 * For a long process sharing the state file with the nightly run (the
 * groups crawler): write only the lookups it changed since `before` onto
 * the file as it is now, so the other process's entries and everything else
 * in the file survive. An entry this process removed is deleted only if the
 * file still holds the value it started from.
 */
export function mergeGroupLookups(
  path: string,
  before: Readonly<Record<string, GroupLookup>>,
  after: Readonly<Record<string, GroupLookup>>,
): void {
  const disk = loadState(path);
  for (const [key, value] of Object.entries(after)) {
    if (!sameLookup(before[key], value)) disk.groupLookups[key] = value;
  }
  for (const key of Object.keys(before)) {
    if (!(key in after) && sameLookup(disk.groupLookups[key], before[key])) {
      delete disk.groupLookups[key];
    }
  }
  saveState(path, disk);
}
