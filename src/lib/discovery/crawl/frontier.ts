// The crawler's queue and visited map, kept in their own state file so the
// frontier (up to 50,000 URLs) never bloats state.json.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { daysBetween, type ISODate } from '../../dates';

export interface QueueEntry {
  url: string;
  priority: number;
  depth: number;
  seedHost: string;
}
export type VisitOutcome =
  'directory' | 'group-homepage' | 'neither' | 'not-classified' | 'skipped' | 'error';
export interface CrawlState {
  version: 1;
  queue: QueueEntry[];
  visited: Record<string, { at: ISODate; outcome: VisitOutcome }>;
  openalexSeeds?: { fetchedAt: ISODate; urls: string[] };
  searchCountryIndex: number;
}

export const MAX_QUEUE = 50_000;
const REVISIT_DAYS = 180;
const DIRECTORY_REVISIT_DAYS = 30;

export function emptyCrawlState(): CrawlState {
  return { version: 1, queue: [], visited: {}, searchCountryIndex: 0 };
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
): void {
  state.visited[url] = { at: today, outcome };
}
