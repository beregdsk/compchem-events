import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { loadEvents } from '../../src/lib/events';
import { eventsExport } from '../../src/pages/events.json';
import worker, { type Env } from '../../src/worker/index';
import { normaliseFilter } from '../../src/worker/prefs';
import { fakeD1 } from './fake-d1';

const ORIGIN = 'https://compchem.observer';
const events = loadEvents({
  eventsDir: 'tests/fixtures/valid',
  today: '2026-09-20',
  includeFixtures: true,
});
const topic = events[0]!.topics[0]!;

function makeEnv(): Env & { DB: ReturnType<typeof fakeD1> } {
  const json = JSON.stringify(eventsExport(events, new Date('2026-09-20T06:00:00Z')));
  return {
    DB: fakeD1(),
    ASSETS: { fetch: () => Promise.resolve(new Response(json)) },
  };
}

function call(
  env: Env,
  method: string,
  init: { cookie?: string; body?: unknown; origin?: string } = {},
) {
  const headers: Record<string, string> = { Origin: init.origin ?? ORIGIN };
  if (init.cookie) headers.Cookie = init.cookie;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return worker.fetch(
    new Request(`${ORIGIN}/api/prefs`, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    env,
  );
}

async function save(env: Env, filter: string, cookie?: string) {
  const res = await call(env, 'PUT', { cookie, body: { filter } });
  const setCookie = res.headers.get('Set-Cookie');
  const body = (await res.json()) as { saved: { filter: string; feed: string } };
  return { res, body, cookie: setCookie?.split(';')[0] ?? cookie };
}

describe('normaliseFilter', () => {
  it('keeps known keys only, in the filter’s own order', () => {
    expect(normaliseFilter('evil=1&region=Europe&topics=dft')).toBe('topics=dft&region=Europe');
  });
});

describe('/api/prefs', () => {
  it('reports nothing saved for a browser without the cookie, and sets no cookie', async () => {
    const res = await call(makeEnv(), 'GET');
    expect(await res.json()).toEqual({ saved: null });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('saves a filter, sets a secure HttpOnly cookie, and reads it back', async () => {
    const env = makeEnv();
    const { res, body, cookie } = await save(env, `topics=${topic}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(body.saved.filter).toBe(`topics=${topic}`);
    expect(body.saved.feed).toMatch(/^\/feed\/my\/[0-9a-f]{32}\.ics$/);

    const read = await call(env, 'GET', { cookie });
    expect(await read.json()).toEqual(body);
  });

  it('updates the filter but keeps the personal feed URL', async () => {
    const env = makeEnv();
    const first = await save(env, `topics=${topic}`);
    const second = await save(env, 'region=Europe', first.cookie);
    expect(second.res.headers.get('Set-Cookie')).toBeNull();
    expect(second.body.saved.filter).toBe('region=Europe');
    expect(second.body.saved.feed).toBe(first.body.saved.feed);
  });

  it('refuses an empty filter, a non-string and an oversized one', async () => {
    const env = makeEnv();
    expect((await call(env, 'PUT', { body: { filter: 'evil=1' } })).status).toBe(400);
    expect((await call(env, 'PUT', { body: { filter: 3 } })).status).toBe(400);
    expect((await call(env, 'PUT', { body: { filter: `q=${'x'.repeat(3000)}` } })).status).toBe(
      400,
    );
  });

  it('refuses writes from another origin', async () => {
    const res = await call(makeEnv(), 'PUT', {
      body: { filter: 'region=Europe' },
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
  });

  it('forgets the filter, and its feed stops working', async () => {
    const env = makeEnv();
    const { body, cookie } = await save(env, `topics=${topic}`);
    expect((await call(env, 'DELETE', { cookie })).status).toBe(204);
    expect(await (await call(env, 'GET', { cookie })).json()).toEqual({ saved: null });
    const feed = await worker.fetch(new Request(ORIGIN + body.saved.feed), env);
    expect(feed.status).toBe(404);
  });
});

describe('/feed/my/<id>.ics', () => {
  it('serves the events matching the saved filter', async () => {
    const env = makeEnv();
    const { body } = await save(env, `topics=${topic}`);
    const res = await worker.fetch(new Request(ORIGIN + body.saved.feed), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-cache');
    const titles = new ICAL.Component(ICAL.parse(await res.text()))
      .getAllSubcomponents('vevent')
      .map((v) => String(new ICAL.Event(v).summary));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(events.find((e) => e.title === t)?.topics).toContain(topic);
  });

  it('404s an unknown or malformed id', async () => {
    const env = makeEnv();
    for (const id of ['0'.repeat(32), 'not-an-id']) {
      const res = await worker.fetch(new Request(`${ORIGIN}/feed/my/${id}.ics`), env);
      expect(res.status).toBe(404);
    }
  });
});

describe('when the database fails', () => {
  it('answers 503 instead of throwing', async () => {
    const env = makeEnv();
    env.DB.raw.exec('DROP TABLE prefs');
    const res = await call(env, 'GET', { cookie: `visitor=${'a'.repeat(32)}` });
    expect(res.status).toBe(503);
  });
});
