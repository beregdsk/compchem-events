import type { D1Database } from './db';
import { isSameOriginWrite, json } from './http';
import { randomId, readVisitor, visitorCookie } from './visitor';

export interface InterestState {
  count: number;
  /** Whether this browser has marked the event. */
  mine: boolean;
}

async function state(db: D1Database, eventId: string, visitor: string | null) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(visitor = ?), 0) AS mine
       FROM interest WHERE event_id = ?`,
    )
    .bind(visitor ?? '', eventId)
    .first<{ count: number; mine: number }>();
  return { count: row?.count ?? 0, mine: (row?.mine ?? 0) > 0 };
}

/**
 * `/api/interest/<event id>`: GET reads the count and whether this browser is
 * in it, POST adds this browser, DELETE removes it. `eventExists` keeps the
 * table to ids the site actually lists.
 */
export async function handleInterest(
  request: Request,
  db: D1Database,
  eventId: string,
  eventExists: (id: string) => Promise<boolean>,
): Promise<Response> {
  if (!(await eventExists(eventId))) return json({ error: 'no such event' }, 404);
  const visitor = readVisitor(request);

  if (request.method === 'GET') return json(await state(db, eventId, visitor));

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json({ error: 'method not allowed' }, 405, { Allow: 'GET, POST, DELETE' });
  }
  if (!isSameOriginWrite(request)) return json({ error: 'cross-origin write refused' }, 403);

  if (request.method === 'DELETE') {
    if (visitor) {
      await db
        .prepare('DELETE FROM interest WHERE event_id = ? AND visitor = ?')
        .bind(eventId, visitor)
        .run();
    }
    return json(await state(db, eventId, visitor));
  }

  const id = visitor ?? randomId();
  await db
    .prepare(
      'INSERT INTO interest (event_id, visitor, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .bind(eventId, id, new Date().toISOString())
    .run();
  return json(
    await state(db, eventId, id),
    200,
    visitor ? {} : { 'Set-Cookie': visitorCookie(id) },
  );
}
