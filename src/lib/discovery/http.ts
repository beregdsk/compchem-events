/**
 * Default timeout for any single outbound HTTP call this pipeline makes.
 * Plain `fetch` has no timeout of its own — a server that accepts the
 * connection and then never responds hangs the call forever, which hangs
 * the whole scheduled run forever with it (observed live: a stalled LLM
 * extraction call blocked an entire cron run for 30+ minutes with no
 * progress). That defeats the `MAX_PAGES`/`MAX_TOKENS`/`MAX_PRS` caps this
 * pipeline is otherwise built around, which all assume a call eventually
 * settles. Every raw `fetchImpl` call in this directory (page fetches,
 * robots.txt, the extraction/classification/GitHub APIs) goes through
 * `fetchWithTimeout` for this reason.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

/**
 * Timeout for one LLM call (extraction, classification). Free models are
 * slow; well-formed extractions were observed taking 20-35s, and 60s cut
 * off calls that would have succeeded.
 */
export const LLM_TIMEOUT_MS = 90_000;

/**
 * Calls `fetchImpl` with a hard timeout via `AbortSignal.timeout`. A caller
 * whose `init` already sets a `signal` is expected not to (none in this
 * directory do); this always wins so the timeout can never be silently
 * dropped.
 */
export function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): ReturnType<typeof fetch> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
