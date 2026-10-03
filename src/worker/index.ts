import { parseFilterState } from '../lib/filter';
import type { LoadedEvent } from '../lib/types';
import type { D1Database } from './db';
import { filteredCalendar } from './feed';
import { filterForFeed, handlePrefs } from './prefs';

/** The static build, bound as `ASSETS` in wrangler.jsonc. */
interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: Assets;
  DB: D1Database;
}

/** Every event in the current build, read from its own `/events.json`. */
export async function loadBuiltEvents(env: Env, origin: string): Promise<LoadedEvent[]> {
  const res = await env.ASSETS.fetch(new Request(new URL('/events.json', origin)));
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
  const body = (await res.json()) as { events: LoadedEvent[] };
  return body.events;
}

const PERSONAL_FEED = /^\/feed\/my\/([^/]+)\.ics$/;

async function calendar(env: Env, url: URL, filter: URLSearchParams, cacheControl: string) {
  const events = await loadBuiltEvents(env, url.origin);
  return new Response(filteredCalendar(events, parseFilterState(filter), new Date()), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === '/api/prefs') return handlePrefs(request, env.DB);

  if (url.pathname.startsWith('/feed/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    // Calendar apps poll; an hour matches how often the data can change.
    if (url.pathname === '/feed/events.ics')
      return calendar(env, url, url.searchParams, 'public, max-age=3600');

    const personal = PERSONAL_FEED.exec(url.pathname);
    if (personal) {
      const filter = await filterForFeed(env.DB, personal[1]!);
      if (filter === null) return new Response('No such feed', { status: 404 });
      // Never cached: a changed or forgotten filter must take effect on the next poll.
      return calendar(env, url, new URLSearchParams(filter), 'private, no-cache');
    }
  }

  return env.ASSETS.fetch(request);
}

/**
 * Only the paths listed under `run_worker_first` in wrangler.jsonc reach this
 * handler; everything else is served straight from the static build.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      return await route(request, env, url);
    } catch (err) {
      // The pages are static files and keep working; only this request fails.
      console.error(err);
      return new Response('Temporarily unavailable', { status: 503 });
    }
  },
};
