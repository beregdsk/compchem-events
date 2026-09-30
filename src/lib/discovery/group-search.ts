// The one discovery LLM call with a tool: OpenRouter's `web` plugin, used
// only to find candidate homepages. Only the response's url_citation URLs
// are kept; the prose is discarded, so no model-typed URL is ever fetched.
// See docs/discovery-agent.md's Security model.
import {
  awaitModelSlot,
  DEFAULT_EXTRACT_BASE_URL,
  failedResponseError,
  withRetries,
  type ExtractOptions,
} from './extract-client';
import { fetchWithTimeout, LLM_TIMEOUT_MS } from './http';

const SEARCH_RESULTS = 5;

/** https, a DNS name, and not a local or private name. IP literals are never a group homepage. */
export function isPublicHttpsUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return false;
  if (host === 'localhost' || !host.includes('.')) return false;
  return !/\.(local|localhost|internal|lan|home|arpa)$/.test(host);
}

interface Annotation {
  type?: string;
  url_citation?: { url?: unknown };
}

export async function searchGroupWebsites(
  query: string,
  options: ExtractOptions,
): Promise<string[]> {
  return withRetries(options, async () => {
    await awaitModelSlot(options);
    const response = await fetchWithTimeout(
      options.fetchImpl ?? fetch,
      options.baseUrl ?? DEFAULT_EXTRACT_BASE_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          plugins: [{ id: 'web', max_results: SEARCH_RESULTS }],
          messages: [
            {
              role: 'system',
              content:
                'Find the official homepage of the research group or organisation named by the user. Reply with one short sentence.',
            },
            { role: 'user', content: query },
          ],
        }),
      },
      LLM_TIMEOUT_MS,
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw failedResponseError(
        `search request failed: ${response.status} ${response.statusText}`,
        response,
        body,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { annotations?: Annotation[] } }>;
      usage?: { total_tokens?: number };
    };
    options.onUsage?.(data.usage?.total_tokens ?? 0);
    const urls: string[] = [];
    for (const a of data.choices?.[0]?.message?.annotations ?? []) {
      const url = a.type === 'url_citation' ? a.url_citation?.url : undefined;
      if (typeof url === 'string' && isPublicHttpsUrl(url) && !urls.includes(url)) urls.push(url);
    }
    return urls;
  });
}
