// The crawler's queue and visited map, kept in their own state file so the
// frontier (up to 50,000 URLs) never bloats state.json.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { daysBetween, type ISODate } from '../../dates';
import type { GroupLead } from '../parsers/group-listing';

export interface QueueEntry {
  url: string;
  priority: number;
  depth: number;
  seedHost: string;
  /** Failed fetches so far (timeouts, 429, 5xx); dropped after MAX_RETRIES. */
  retries?: number;
}
export type VisitOutcome =
  'directory' | 'group-homepage' | 'neither' | 'not-classified' | 'skipped' | 'error';
export interface CrawlState {
  version: 1;
  queue: QueueEntry[];
  /** For a directory, also where it was found, so it can be re-queued after 30 days. */
  visited: Record<
    string,
    { at: ISODate; outcome: VisitOutcome; depth?: number; seedHost?: string }
  >;
  /** Leads found but not yet resolved or proposed: survive a kill between the crawl and proposing. */
  pendingLeads: GroupLead[];
  openalexSeeds?: { fetchedAt: ISODate; urls: string[] };
  searchCountryIndex: number;
}

export const MAX_QUEUE = 50_000;
const REVISIT_DAYS = 180;
const DIRECTORY_REVISIT_DAYS = 30;
export const MAX_RETRIES = 3;
/** Stale directories go back on the queue here: that is where new groups appear. */
const DIRECTORY_REQUEUE_PRIORITY = 10;

export function emptyCrawlState(): CrawlState {
  return { version: 1, queue: [], visited: {}, pendingLeads: [], searchCountryIndex: 0 };
}

export function loadCrawlState(path: string): CrawlState {
  if (!existsSync(path)) return emptyCrawlState();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<CrawlState>;
    if (data.version !== 1 || !Array.isArray(data.queue) || typeof data.visited !== 'object') {
      return emptyCrawlState();
    }
    return { ...emptyCrawlState(), ...data } as CrawlState;
  } catch {
    return emptyCrawlState();
  }
}

/** Temp file then rename, so a kill mid-write never leaves a torn file. */
export function saveCrawlState(path: string, state: CrawlState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

export function isFresh(state: CrawlState, url: string, today: ISODate): boolean {
  const v = state.visited[url];
  if (!v || v.outcome === 'error') return false;
  const age = daysBetween(v.at, today);
  return age < (v.outcome === 'directory' ? DIRECTORY_REVISIT_DAYS : REVISIT_DAYS);
}

export function enqueue(state: CrawlState, entries: readonly QueueEntry[], today: ISODate): number {
  const byUrl = new Map(state.queue.map((q) => [q.url, q]));
  let changed = 0;
  for (const entry of entries) {
    if (isFresh(state, entry.url, today)) continue;
    const existing = byUrl.get(entry.url);
    if (existing) {
      if (entry.priority > existing.priority) {
        existing.priority = entry.priority;
        changed += 1;
      }
      continue;
    }
    const copy = { ...entry };
    byUrl.set(entry.url, copy);
    state.queue.push(copy);
    changed += 1;
  }
  if (state.queue.length > MAX_QUEUE) {
    state.queue.sort((a, b) => b.priority - a.priority);
    state.queue.length = MAX_QUEUE;
  }
  return changed;
}

export function takeNext(
  state: CrawlState,
  n: number,
  taken: ReadonlyMap<string, number>,
  hostCap: number,
  paused: ReadonlySet<string>,
): QueueEntry[] {
  const order = [...state.queue].sort((a, b) => b.priority - a.priority);
  const picked: QueueEntry[] = [];
  const hosts = new Set<string>();
  for (const entry of order) {
    if (picked.length >= n) break;
    const host = new URL(entry.url).host;
    if (hosts.has(host) || paused.has(host) || (taken.get(host) ?? 0) >= hostCap) continue;
    hosts.add(host);
    picked.push(entry);
  }
  const chosen = new Set(picked);
  state.queue = state.queue.filter((q) => !chosen.has(q));
  return picked;
}

export function markVisited(
  state: CrawlState,
  url: string,
  outcome: VisitOutcome,
  today: ISODate,
  where?: { depth: number; seedHost: string },
): void {
  state.visited[url] =
    outcome === 'directory' && where ? { at: today, outcome, ...where } : { at: today, outcome };
}

/** Every directory visited 30 or more days ago goes back on the queue, where it was found. */
export function requeueStaleDirectories(state: CrawlState, today: ISODate): void {
  const stale: QueueEntry[] = [];
  for (const [url, v] of Object.entries(state.visited)) {
    if (v.outcome !== 'directory' || v.depth === undefined || !v.seedHost) continue;
    if (isFresh(state, url, today)) continue;
    stale.push({ url, priority: DIRECTORY_REQUEUE_PRIORITY, depth: v.depth, seedHost: v.seedHost });
  }
  enqueue(state, stale, today);
}
