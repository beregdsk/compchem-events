import { fetchWithTimeout } from './http';

/**
 * CECAM's program page (www.cecam.org/program) renders its event list in
 * the browser from this JSON API, so the page's own HTML holds no event
 * links at all — following links from it found nothing. The API answers
 * only a request that looks like it came from that page (a plain POST gets
 * 403), hence the Origin/Referer below. robots.txt on members.cecam.org
 * allows everything.
 */
export const CECAM_EVENTS_API = 'https://members.cecam.org/api/all-events';
const CECAM_ORIGIN = 'https://www.cecam.org';

/** Guards against a paginator that never ends; 15 events a page, ~30 upcoming when checked. */
const MAX_API_PAGES = 10;

export interface CecamEvent {
  title: string;
  slug: string;
  start: string;
  end: string;
  /** e.g. "Flagship Workshop", "Flagship School". */
  event: string;
  /** A venue, a city, or only a CECAM node code such as "CECAM-DE-JUELICH". */
  location: string;
  organisers: Array<{ name: string; surname: string; affiliation: string }>;
}

interface ApiPage {
  success?: string;
  workshops?: { data?: unknown[]; last_page?: number };
}

function isCecamEvent(value: unknown): value is CecamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === 'string' &&
    typeof v.slug === 'string' &&
    /^[a-z0-9-]+$/.test(v.slug) &&
    typeof v.start === 'string' &&
    typeof v.end === 'string' &&
    typeof v.event === 'string' &&
    typeof v.location === 'string' &&
    Array.isArray(v.organisers)
  );
}

/** The event's own page. The slug is checked to be a bare path segment before it gets here. */
export function cecamEventUrl(event: CecamEvent): string {
  return `${CECAM_ORIGIN}/workshop-details/${event.slug}`;
}

/** Every upcoming event, all pages. Malformed entries are skipped. */
export async function fetchCecamEvents(
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CecamEvent[]> {
  const events: CecamEvent[] = [];
  for (let page = 1; page <= MAX_API_PAGES; page++) {
    const response = await fetchWithTimeout(fetchImpl, CECAM_EVENTS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
        Origin: CECAM_ORIGIN,
        Referer: `${CECAM_ORIGIN}/program`,
      },
      body: JSON.stringify({ type: 'all', month: 'all', location: 'all', page, ispast: 'no' }),
    });
    if (!response.ok) throw new Error(`CECAM API: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as ApiPage;
    for (const item of data.workshops?.data ?? []) if (isCecamEvent(item)) events.push(item);
    if (page >= (data.workshops?.last_page ?? 1)) break;
  }
  return events;
}

/**
 * The API's fields as text for the extraction model, to be followed by the
 * event page's own text (which carries the description but, rendered
 * without JavaScript, no dates).
 */
export function cecamEventText(event: CecamEvent): string {
  const organisers = event.organisers
    .map((o) => `${o.name} ${o.surname} (${o.affiliation})`)
    .join('; ');
  return [
    event.title,
    `CECAM ${event.event}`,
    `Dates: ${event.start} to ${event.end}`,
    `Location: ${event.location}`,
    `URL: ${cecamEventUrl(event)}`,
    organisers ? `Organisers: ${organisers}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
