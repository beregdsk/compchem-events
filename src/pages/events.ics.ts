import type { APIRoute } from 'astro';
import { buildCalendar, type VEventInput } from '../lib/ical';
import { loadEvents, upcomingEvents } from '../lib/events';
import type { LoadedEvent } from '../lib/types';
import { site, siteDomain } from '../../site.config';

export function eventsCalendar(events: LoadedEvent[], stamp: Date): string {
  const items: VEventInput[] = events.map((e) => ({
    uid: `${e.id}@${siteDomain}`,
    summary: e.title,
    description: [e.description, e.url].join('\n\n'),
    start: e.start_date,
    end: e.end_date,
    url: e.url,
    location:
      e.format === 'online'
        ? 'Online'
        : [e.location?.venue, e.location?.city, e.location?.country].filter(Boolean).join(', '),
    cancelled: e.status === 'cancelled',
  }));
  return buildCalendar(`${site.name} — events`, items, stamp);
}

export const GET: APIRoute = () =>
  new Response(eventsCalendar(upcomingEvents(loadEvents()), new Date()), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
