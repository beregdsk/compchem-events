import { parseFilterState } from '../lib/filter';
import type { LoadedEvent } from '../lib/types';
import { filteredCalendar } from './feed';

/** The static build, bound as `ASSETS` in wrangler.jsonc. */
interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Assets;
}

/** Every event in the current build, read from its own `/events.json`. */
export async function loadBuiltEvents(env: Env, origin: string): Promise<LoadedEvent[]> {
  const res = await env.ASSETS.fetch(new Request(new URL('/events.json', origin)));
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
  const body = (await res.json()) as { events: LoadedEvent[] };
  return body.events;
}

/**
 * Only the paths listed under `run_worker_first` in wrangler.jsonc reach this
 * handler; everything else is served straight from the static build.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/feed/events.ics') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }
      const events = await loadBuiltEvents(env, url.origin);
      const ics = filteredCalendar(events, parseFilterState(url.searchParams), new Date());
      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          // Calendar apps poll; an hour matches how often the data can change.
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
