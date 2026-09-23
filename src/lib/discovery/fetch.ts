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
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim());
  const disallowed: string[] = [];
  let inWildcardGroup = false;
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      inWildcardGroup = value === '*';
      continue;
    }
    if (key === 'disallow' && inWildcardGroup && value) disallowed.push(value);
  }
  return !disallowed.some((prefix) => path.startsWith(prefix));
}

/**
 * A fetch failure (thrown error or non-ok response) returns '' (allow-all)
 * for this call only — it is never written into `hostState.robotsTxt`, so a
 * transient network blip during one cron run doesn't permanently disable
 * robots.txt enforcement for that host in the persisted state.
 */
async function ensureRobots(
  host: string,
  options: FetchOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  const hostState = (options.state.hosts[host] ??= {});
  if (hostState.robotsTxt !== undefined) return hostState.robotsTxt;
  try {
    const res = await fetchImpl(`https://${host}/robots.txt`, {
      headers: { 'User-Agent': options.userAgent },
    });
    if (!res.ok) return '';
    hostState.robotsTxt = await res.text();
    return hostState.robotsTxt;
  } catch {
    return '';
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

  const robotsTxt = await ensureRobots(host, options, fetchImpl);
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
