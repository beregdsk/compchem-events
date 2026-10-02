import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { loadEvents } from '../../src/lib/events';
import { EMPTY_FILTER } from '../../src/lib/filter';
import { filteredCalendar } from '../../src/worker/feed';
import worker, { type Env } from '../../src/worker/index';
import { eventsExport } from '../../src/pages/events.json';

const events = loadEvents({
  eventsDir: 'tests/fixtures/valid',
  today: '2026-09-20',
  includeFixtures: true,
});
const now = new Date('2026-09-20T06:00:00Z');

function summaries(ics: string): string[] {
  return new ICAL.Component(ICAL.parse(ics))
    .getAllSubcomponents('vevent')
    .map((v) => String(new ICAL.Event(v).summary));
}

describe('filteredCalendar', () => {
  it('with no filter, lists every event that has not ended', () => {
    const upcoming = events.filter((e) => e.end_date >= '2026-09-20');
    expect(summaries(filteredCalendar(events, EMPTY_FILTER, now))).toEqual(
      upcoming.map((e) => e.title),
    );
  });

  it('applies the same filter the list page does', () => {
    const topic = events[0]!.topics[0]!;
    const state = { ...EMPTY_FILTER, topics: [topic] };
    const expected = events
      .filter((e) => e.end_date >= '2026-09-20' && e.topics.includes(topic))
      .map((e) => e.title);
    expect(expected.length).toBeGreaterThan(0);
    expect(summaries(filteredCalendar(events, state, now))).toEqual(expected);
  });

  it('drops events that ended after the build but before the request', () => {
    const later = new Date('2099-01-01T00:00:00Z');
    expect(summaries(filteredCalendar(events, EMPTY_FILTER, later))).toEqual([]);
  });
});

describe('worker', () => {
  const json = JSON.stringify(eventsExport(events, now));
  const passedThrough: string[] = [];
  const env: Env = {
    ASSETS: {
      fetch: (req: Request) => {
        const path = new URL(req.url).pathname;
        if (path === '/events.json') return Promise.resolve(new Response(json));
        passedThrough.push(path);
        return Promise.resolve(new Response('static'));
      },
    },
  };

  it('serves /feed/events.ics as a filtered calendar', async () => {
    const topic = events[0]!.topics[0]!;
    const res = await worker.fetch(
      new Request(`https://compchem.observer/feed/events.ics?topics=${topic}`),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/calendar');
    const titles = summaries(await res.text());
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(events.find((e) => e.title === t)?.topics).toContain(topic);
    }
  });

  it('refuses writes to the feed', async () => {
    const res = await worker.fetch(
      new Request('https://compchem.observer/feed/events.ics', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it('hands every other path to the static build', async () => {
    const res = await worker.fetch(new Request('https://compchem.observer/feed/other'), env);
    expect(await res.text()).toBe('static');
    expect(passedThrough).toContain('/feed/other');
  });
});
