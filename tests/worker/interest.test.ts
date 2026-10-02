import { describe, expect, it } from 'vitest';
import { loadEvents } from '../../src/lib/events';
import { eventsExport } from '../../src/pages/events.json';
import worker, { type Env } from '../../src/worker/index';
import { fakeD1 } from './fake-d1';

const ORIGIN = 'https://compchem.observer';
const events = loadEvents({
  eventsDir: 'tests/fixtures/valid',
  today: '2026-09-20',
  includeFixtures: true,
});
const id = events[0]!.id;

function makeEnv(): Env {
  const json = JSON.stringify(eventsExport(events, new Date('2026-09-20T06:00:00Z')));
  return { DB: fakeD1(), ASSETS: { fetch: () => Promise.resolve(new Response(json)) } };
}

async function call(
  env: Env,
  method: string,
  init: { cookie?: string; origin?: string; event?: string } = {},
) {
  const headers: Record<string, string> = { Origin: init.origin ?? ORIGIN };
  if (init.cookie) headers.Cookie = init.cookie;
  const res = await worker.fetch(
    new Request(`${ORIGIN}/api/interest/${init.event ?? id}`, { method, headers }),
    env,
  );
  return { res, cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? init.cookie };
}

describe('/api/interest/<id>', () => {
  it('starts at zero', async () => {
    const { res } = await call(makeEnv(), 'GET');
    expect(await res.json()).toEqual({ count: 0, mine: false });
  });

  it('counts each browser once, however often it marks', async () => {
    const env = makeEnv();
    const a = await call(env, 'POST');
    expect(a.res.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    await call(env, 'POST', { cookie: a.cookie });
    const b = await call(env, 'POST');
    expect(await b.res.json()).toEqual({ count: 2, mine: true });
    expect(await (await call(env, 'GET', { cookie: a.cookie })).res.json()).toEqual({
      count: 2,
      mine: true,
    });
    expect(await (await call(env, 'GET')).res.json()).toEqual({ count: 2, mine: false });
  });

  it('un-marks with DELETE', async () => {
    const env = makeEnv();
    const { cookie } = await call(env, 'POST');
    const { res } = await call(env, 'DELETE', { cookie });
    expect(await res.json()).toEqual({ count: 0, mine: false });
  });

  it('shares the visitor cookie with saved preferences', async () => {
    const env = makeEnv();
    const { cookie } = await call(env, 'POST');
    const prefs = await worker.fetch(
      new Request(`${ORIGIN}/api/prefs`, {
        method: 'PUT',
        headers: { Origin: ORIGIN, Cookie: cookie!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: 'region=Europe' }),
      }),
      env,
    );
    expect(prefs.headers.get('Set-Cookie')).toBeNull();
  });

  it('404s an id the site does not list, and stores nothing for it', async () => {
    const env = makeEnv();
    expect((await call(env, 'POST', { event: 'made-up-event-2026' })).res.status).toBe(404);
  });

  it('refuses cross-origin writes', async () => {
    const { res } = await call(makeEnv(), 'POST', { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('refuses other methods', async () => {
    const { res } = await call(makeEnv(), 'PUT');
    expect(res.status).toBe(405);
  });
});
