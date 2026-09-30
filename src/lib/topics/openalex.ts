// A minimal OpenAlex REST client: mailto and optional key on every request,
// three attempts on 429/5xx/dropped connections. OpenAlex data is untrusted
// input (AGENTS.md rule 7); callers render it as text.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from '../discovery/http';

export interface OpenAlexOptions {
  mailto: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const ATTEMPTS = 3;

export function stripId(url: string): string {
  return url.replace(/^https:\/\/openalex\.org\//, '');
}

const isTransient = (err: unknown) =>
  err instanceof TypeError || (err instanceof Error && err.name === 'TimeoutError');

export async function openAlexGet<T>(
  path: string,
  params: Record<string, string>,
  o: OpenAlexOptions,
): Promise<T> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const url = new URL(path, o.baseUrl ?? 'https://api.openalex.org');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('mailto', o.mailto);
  // Errors name the path and params only; the key is added last and never printed.
  const shown = `${url.pathname}?${url.searchParams.toString()}`;
  if (o.apiKey) url.searchParams.set('api_key', o.apiKey);

  let last = '';
  for (let n = 1; n <= ATTEMPTS; n++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(fetchImpl, url.toString(), {}, DEFAULT_FETCH_TIMEOUT_MS);
    } catch (err) {
      if (!isTransient(err)) throw err;
      last = `OpenAlex ${shown}: ${(err as Error).message}`;
      if (n < ATTEMPTS) await sleep(2000 * n);
      continue;
    }
    if (response.ok) return (await response.json()) as T;
    last = `OpenAlex ${shown}: HTTP ${response.status}`;
    if (response.status !== 429 && response.status < 500) throw new Error(last);
    const retryAfter = Number(response.headers.get('retry-after'));
    if (n < ATTEMPTS) {
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * n);
    }
  }
  throw new Error(last);
}
