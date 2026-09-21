import type { APIRoute } from 'astro';
import { buildCalendar, type VEventInput } from '../lib/ical';
import { loadEvents, upcomingDeadlines } from '../lib/events';
import { todayUTC, type ISODate } from '../lib/dates';
import type { LoadedEvent } from '../lib/types';
import { site, siteDomain } from '../../site.config';

const LABELS: Record<string, string> = {
  abstract: 'Abstract deadline',
  registration: 'Registration deadline',
  early_bird: 'Early bird deadline',
  travel_grant: 'Travel grant deadline',
  poster: 'Poster deadline',
  application: 'Application deadline',
};

export function deadlinesCalendar(events: LoadedEvent[], today: ISODate, stamp: Date): string {
  const items: VEventInput[] = upcomingDeadlines(events, today).map(({ event, deadline }) => {
    const zone = deadline.timezone ?? 'AoE';
    return {
      uid: `${event.id}-${deadline.type}@${siteDomain}`,
      summary: `[${LABELS[deadline.type] ?? deadline.type}] ${event.title}`,
      description: [
        `Timezone: ${zone === 'AoE' ? 'AoE (Anywhere on Earth)' : zone}`,
        deadline.note ?? '',
        event.url,
      ]
        .filter(Boolean)
        .join('\n'),
      // A deadline is a single all-day entry on its own date.
      start: deadline.date,
      end: deadline.date,
      url: event.url,
    };
  });
  return buildCalendar(`${site.name} — deadlines`, items, stamp);
}

export const GET: APIRoute = () =>
  new Response(deadlinesCalendar(loadEvents(), todayUTC(), new Date()), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
