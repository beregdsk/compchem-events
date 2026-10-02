import { buildCalendar, type VEventInput } from './ical';
import type { RawEvent } from './types';
import { site, siteDomain } from '../../site.config';

/** One VEVENT per event. Shared by the build-time feeds and the Worker's filtered feed. */
export function eventsCalendar(events: RawEvent[], stamp: Date, scope = 'events'): string {
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
  return buildCalendar(`${site.name} — ${scope}`, items, stamp);
}
