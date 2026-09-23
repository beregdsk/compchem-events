import ICAL from 'ical.js';
import { addDays, type ISODate } from '../../dates';
import type { RawEvent } from '../../types';
import { synthesizeDraft } from '../draft';

const TYPE_KEYWORDS: Array<[RegExp, RawEvent['type']]> = [
  [/\bconference\b/i, 'conference'],
  [/\bsymposium\b/i, 'symposium'],
  [/\bschool\b/i, 'school'],
  [/\bwebinar\b/i, 'webinar'],
  [/\bhackathon\b/i, 'hackathon'],
  [/\bworkshop\b/i, 'workshop'],
];

/** Keyword scan over the title/description; no ical.js field carries this directly. */
export function inferEventType(text: string): RawEvent['type'] {
  for (const [pattern, type] of TYPE_KEYWORDS) {
    if (pattern.test(text)) return type;
  }
  return 'workshop';
}

function toISODate(value: unknown): ISODate | undefined {
  const s = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

/**
 * Parses an iCalendar feed straight into candidate drafts, no LLM call.
 * For an all-day (`VALUE=DATE`) VEVENT, DTEND is exclusive per RFC 5545
 * (see `src/lib/ical.ts`'s own header comment on `buildCalendar`), so
 * `end_date` is DTEND minus one day. A timed (`DATE-TIME`) VEVENT's DTEND
 * is the literal end instant, not an exclusive day boundary, so its
 * calendar-date portion is used as-is.
 */
export function parseICalFeed(feedText: string, sourceUrl: string, today: ISODate): RawEvent[] {
  try {
    const root: unknown = ICAL.parse(feedText);
    const drafts: RawEvent[] = [];
    const comp = new ICAL.Component(root as never);
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(vevent);
      const start = toISODate(event.startDate?.toString());
      const rawEnd = toISODate(event.endDate?.toString());
      if (!start || !rawEnd || !event.summary) continue;
      const end = event.endDate?.isDate ? addDays(rawEnd, -1) : rawEnd;

      const location = event.location || undefined;
      const format: RawEvent['format'] = location ? 'in-person' : 'online';
      const eventUrl = (vevent.getFirstPropertyValue('url') as string | null) ?? sourceUrl;

      drafts.push(
        synthesizeDraft(
          {
            title: event.summary,
            type: inferEventType(`${event.summary} ${event.description ?? ''}`),
            start_date: start,
            end_date: end,
            format,
            url: eventUrl,
            source_url: sourceUrl,
            topics: [],
            description: (event.description || event.summary).slice(0, 280),
          },
          today,
        ),
      );
    }
    return drafts;
  } catch {
    return [];
  }
}
