import { createHash } from 'node:crypto';
import type { DiscoveryState } from './state';

export type FetchResult =
  | { status: 'fetched'; body: string }
  | { status: 'unchanged' }
  | { status: 'skipped'; reason: 'robots-disallowed' }
  | { status: 'error'; error: string };

export interface FetchOptions {
  state: DiscoveryState;
  userAgent: string;
  fetchImpl?: typeof fetch;
  minHostIntervalMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const DEFAULT_MIN_HOST_INTERVAL_MS = 3000;

function hostOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

function hashOf(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Only the `User-agent: *` group is honoured — every source in
 * data/sources.yaml relies on a wildcard-only robots.txt, and a full
 * multi-agent precedence parser is not needed to serve them.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  // Comments run from `#` to end of line per the informal robots.txt
  // convention, and must be stripped before a line's key/value is parsed —
  // otherwise a trailing comment on a Disallow line becomes part of the
  // path and never matches anything.
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const disallowed: string[] = [];
  let inWildcardGroup = false;
  // Consecutive `User-agent:` lines with no Allow/Disallow between them
  // belong to the SAME rule group per the robots.txt convention (e.g.
  // `User-agent: *` immediately followed by `User-agent: SomeBot` is one
  // group covering both agents). Only a `User-agent:` line that follows a
  // non-agent directive starts a genuinely new group.
  let stackingUserAgent = false;
  for (const line of lines) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!stackingUserAgent) inWildcardGroup = false;
      if (value === '*') inWildcardGroup = true;
      stackingUserAgent = true;
      continue;
    }
    stackingUserAgent = false;
    if (key === 'disallow' && inWildcardGroup && value) disallowed.push(value);
  }
  return !disallowed.some((prefix) => path.startsWith(prefix));
}

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A fetch failure (thrown error or non-ok response) falls back to whatever
 * robots.txt is already cached for this host (or '' — allow-all — if
 * nothing was ever cached) for this call only; a fresh failure/non-ok
 * result is never written into `hostState.robotsTxt`, so a transient
 * network blip during one cron run doesn't permanently disable robots.txt
 * enforcement for that host in the persisted state, and doesn't discard a
 * still-usable (if stale) cached copy either.
 *
 * The cached copy is treated as stale — and re-fetched — once it is more
 * than 24h old (`robotsFetchedAt`), so a site that adds new Disallow rules
 * is eventually honoured instead of being cached forever.
 */
async function ensureRobots(
  host: string,
  options: FetchOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
): Promise<string> {
  const hostState = (options.state.hosts[host] ??= {});
  if (hostState.robotsTxt !== undefined && hostState.robotsFetchedAt !== undefined) {
    const age = now().getTime() - new Date(hostState.robotsFetchedAt).getTime();
    if (age < ROBOTS_TTL_MS) return hostState.robotsTxt;
  }
  try {
    const res = await fetchImpl(`https://${host}/robots.txt`, {
      headers: { 'User-Agent': options.userAgent },
    });
    if (!res.ok) return hostState.robotsTxt ?? '';
    hostState.robotsTxt = await res.text();
    hostState.robotsFetchedAt = now().toISOString();
    return hostState.robotsTxt;
  } catch {
    return hostState.robotsTxt ?? '';
  }
}

/** Fetches one URL politely: robots.txt-aware, per-host rate-limited, conditional on ETag/content hash. */
export async function politeFetch(url: string, options: FetchOptions): Promise<FetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => new Date());
  const minInterval = options.minHostIntervalMs ?? DEFAULT_MIN_HOST_INTERVAL_MS;
  const host = hostOf(url);
  const { state } = options;
  const hostState = (state.hosts[host] ??= {});

  const robotsTxt = await ensureRobots(host, options, fetchImpl, now);
  const path = new URL(url).pathname;
  if (!robotsAllows(robotsTxt, path)) {
    return { status: 'skipped', reason: 'robots-disallowed' };
  }

  if (hostState.lastRequestAt) {
    const elapsed = now().getTime() - new Date(hostState.lastRequestAt).getTime();
    if (elapsed < minInterval) await sleepImpl(minInterval - elapsed);
  }

  const cached = state.pages[url];
  const headers: Record<string, string> = { 'User-Agent': options.userAgent };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (err) {
    hostState.lastRequestAt = now().toISOString();
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
  hostState.lastRequestAt = now().toISOString();

  if (response.status === 304) {
    if (cached) state.pages[url] = { ...cached, fetchedAt: now().toISOString() };
    return { status: 'unchanged' };
  }
  if (!response.ok) {
    return { status: 'error', error: `${response.status} ${response.statusText}` };
  }

  const body = await response.text();
  const contentHash = hashOf(body);
  const fetchedAt = now().toISOString();
  if (cached?.contentHash === contentHash) {
    state.pages[url] = { ...cached, fetchedAt };
    return { status: 'unchanged' };
  }

  state.pages[url] = {
    etag: response.headers.get('etag') ?? undefined,
    contentHash,
    fetchedAt,
  };
  return { status: 'fetched', body };
}
