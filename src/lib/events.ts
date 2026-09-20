import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compareISO, daysBetween, todayUTC, type ISODate } from './dates';
import { regionOf, type DisplayRegion } from './regions';
import {
  formatProblems,
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationResult,
} from './validation';
import type { Deadline, DerivedStatus, LoadedEvent, RawEvent } from './types';

export interface LoadOptions {
  /** Directory holding `<year>/<id>.yaml`. Defaults to `data/events`. */
  eventsDir?: string;
  /** The build date, as a UTC calendar date. Defaults to today. */
  today?: ISODate;
  /** Defaults to false in production builds, true otherwise. */
  includeFixtures?: boolean;
}

export interface UpcomingDeadline {
  event: LoadedEvent;
  deadline: Deadline;
}

export function deriveStatus(event: RawEvent, today: ISODate): DerivedStatus {
  if (compareISO(event.end_date, today) < 0) return 'past';
  if (compareISO(event.start_date, today) > 0) return 'upcoming';
  return 'ongoing';
}

/**
 * `'Online'` is reserved by spec D6 for "online format, or no location" — it
 * must never mean "we couldn't work out the region." If a located,
 * non-online event's country has no entry in `COUNTRY_REGIONS`, fail loudly
 * instead of relabelling it Online, which would silently conflate the two.
 * Unreachable today: the validator's rule 4 already rejects any country not
 * in the region table, so this only fires if that invariant is ever dropped
 * or the two tables drift apart.
 */
function regionFor(e: RawEvent): DisplayRegion {
  if (e.format === 'online' || !e.location) return 'Online';
  const region = regionOf(e.location.country);
  if (region === undefined) {
    throw new Error(
      `event ${e.id}: country "${e.location.country}" has no region; add it to src/lib/regions.ts`,
    );
  }
  return region;
}

function readAll(dir: string): EventFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: join(dir, p).split('\\').join('/'),
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

/**
 * Holds the result of the most recent bare `loadEvents()` call (no options
 * given at all). There is only one slot: it is consulted and populated only
 * when `isDefault` is true below, so any explicit option bypasses it entirely
 * and never reads or writes it. `today` is captured at the moment the cache
 * is populated and is never refreshed afterwards. That is correct and
 * desirable for a one-shot `astro build`. A long-running `astro dev` server,
 * however, will keep serving `status_derived` (and any date-relative
 * selector built on it) computed against that captured `today` across a UTC
 * day boundary, until the process is restarted — this is accepted rather
 * than adding invalidation to a build-time module, since production rebuilds
 * daily anyway.
 */
let cached: LoadedEvent[] | undefined;

export function loadEvents(options: LoadOptions = {}): LoadedEvent[] {
  const eventsDir = options.eventsDir ?? 'data/events';
  const today = options.today ?? todayUTC();
  const includeFixtures = options.includeFixtures ?? process.env.NODE_ENV !== 'production';
  const isDefault =
    options.eventsDir === undefined &&
    options.today === undefined &&
    options.includeFixtures === undefined;

  if (isDefault && cached) return cached;

  const entries = readAll(eventsDir);
  const ctx = loadValidationContext('.', today);
  const all: ValidationResult = { errors: [], warnings: [] };

  for (const entry of entries) {
    const r = validateEvent(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  const collection = validateCollection(entries, ctx);
  all.errors.push(...collection.errors);
  all.warnings.push(...collection.warnings);

  if (all.errors.length > 0) {
    throw new Error(`event data validation failed:\n${formatProblems(all)}`);
  }
  for (const w of all.warnings) {
    console.warn(`WARN ${w.file}: ${w.field}: ${w.message}`);
  }

  const events = entries
    .map((entry) => entry.data as RawEvent)
    .filter((e) => includeFixtures || e.fixture !== true)
    .map<LoadedEvent>((e) => ({
      ...e,
      region: regionFor(e),
      status_derived: deriveStatus(e, today),
    }))
    .sort((a, b) => compareISO(a.start_date, b.start_date) || a.title.localeCompare(b.title));

  if (isDefault) cached = events;
  return events;
}

export function upcomingEvents(events: LoadedEvent[]): LoadedEvent[] {
  return events.filter((e) => e.status_derived !== 'past');
}

export function pastEvents(events: LoadedEvent[]): LoadedEvent[] {
  return events
    .filter((e) => e.status_derived === 'past')
    .sort((a, b) => compareISO(b.start_date, a.start_date));
}

export function eventById(events: LoadedEvent[], id: string): LoadedEvent | undefined {
  return events.find((e) => e.id === id);
}

export function hasOpenDeadline(event: LoadedEvent, today: ISODate): boolean {
  return (event.deadlines ?? []).some((d) => compareISO(d.date, today) >= 0);
}

export function upcomingDeadlines(events: LoadedEvent[], today: ISODate): UpcomingDeadline[] {
  return events
    .filter((e) => e.status !== 'cancelled' && e.status_derived !== 'past')
    .flatMap((event) =>
      (event.deadlines ?? [])
        .filter((deadline) => compareISO(deadline.date, today) >= 0)
        .map((deadline) => ({ event, deadline })),
    )
    .sort(
      (a, b) =>
        compareISO(a.deadline.date, b.deadline.date) || a.event.title.localeCompare(b.event.title),
    );
}

/** True when the dates need re-checking: unverified for 90 days and not yet started. */
export function isStale(event: LoadedEvent, today: ISODate): boolean {
  return compareISO(event.start_date, today) > 0 && daysBetween(event.last_verified, today) > 90;
}
