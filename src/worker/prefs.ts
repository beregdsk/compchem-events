import { isEmptyFilter, parseFilterState, serialiseFilterState } from '../lib/filter';
import type { D1Database } from './db';
import { randomId, readVisitor, visitorCookie } from './visitor';

/** Longer than any real filter; stops the table being used as free storage. */
const MAX_FILTER_LENGTH = 2000;

interface PrefsRow {
  feed_id: string;
  filter: string;
}

export interface SavedFilter {
  /** The list page's query string, without `?`. */
  filter: string;
  /** Path of the personal calendar that follows this filter; the page makes it absolute. */
  feed: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Round-trips through the filter's own parser, so only known keys with clean values are stored. */
export function normaliseFilter(raw: string): string {
  return serialiseFilterState(parseFilterState(new URLSearchParams(raw))).toString();
}

function saved(row: PrefsRow): SavedFilter {
  return { filter: row.filter, feed: `/feed/my/${row.feed_id}.ics` };
}

/**
 * `/api/prefs`: GET reads this browser's saved filter, PUT `{ filter }` saves
 * it, DELETE forgets it. Writes must come from the site's own pages: a
 * cross-site page could otherwise overwrite a visitor's filter with their
 * cookie.
 */
export async function handlePrefs(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const visitor = readVisitor(request);

  if (request.method === 'GET') {
    if (!visitor) return json({ saved: null });
    const row = await db
      .prepare('SELECT feed_id, filter FROM prefs WHERE visitor = ?')
      .bind(visitor)
      .first<PrefsRow>();
    return json({ saved: row ? saved(row) : null });
  }

  if (request.method !== 'PUT' && request.method !== 'DELETE') {
    return json({ error: 'method not allowed' }, 405, { Allow: 'GET, PUT, DELETE' });
  }
  if (request.headers.get('Origin') !== url.origin) {
    return json({ error: 'cross-origin write refused' }, 403);
  }

  if (request.method === 'DELETE') {
    if (visitor) await db.prepare('DELETE FROM prefs WHERE visitor = ?').bind(visitor).run();
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const raw = (body as { filter?: unknown } | null)?.filter;
  if (typeof raw !== 'string' || raw.length > MAX_FILTER_LENGTH) {
    return json({ error: 'filter must be a query string' }, 400);
  }
  const filter = normaliseFilter(raw);
  if (isEmptyFilter(parseFilterState(new URLSearchParams(filter)))) {
    return json({ error: 'nothing to save: choose a filter first' }, 400);
  }

  const id = visitor ?? randomId();
  // The feed id is kept on update, so a calendar subscription survives a new filter.
  await db
    .prepare(
      `INSERT INTO prefs (visitor, feed_id, filter, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (visitor) DO UPDATE SET filter = excluded.filter, updated_at = excluded.updated_at`,
    )
    .bind(id, randomId(), filter, new Date().toISOString())
    .run();
  const row = await db
    .prepare('SELECT feed_id, filter FROM prefs WHERE visitor = ?')
    .bind(id)
    .first<PrefsRow>();
  if (!row) return json({ error: 'save failed' }, 500);
  return json({ saved: saved(row) }, 200, visitor ? {} : { 'Set-Cookie': visitorCookie(id) });
}

/** The saved filter behind a personal feed id, or null if there is none. */
export async function filterForFeed(db: D1Database, feedId: string): Promise<string | null> {
  if (!/^[0-9a-f]{32}$/.test(feedId)) return null;
  const row = await db
    .prepare('SELECT filter FROM prefs WHERE feed_id = ?')
    .bind(feedId)
    .first<{ filter: string }>();
  return row?.filter ?? null;
}
