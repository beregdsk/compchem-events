import { eventsCalendar } from '../lib/event-calendar';
import { compareISO, todayUTC } from '../lib/dates';
import { filterRowFromEvent, isEmptyFilter, matchesFilter, type FilterState } from '../lib/filter';
import type { LoadedEvent } from '../lib/types';

/**
 * The upcoming events matching `state` on the day of `now`, as iCalendar.
 * "Upcoming" is recomputed here rather than read from the build's
 * `status_derived`, so a feed fetched days after the last build still drops
 * events that have ended.
 */
export function filteredCalendar(events: LoadedEvent[], state: FilterState, now: Date): string {
  const today = todayUTC(now);
  const matching = events.filter(
    (e) => compareISO(e.end_date, today) >= 0 && matchesFilter(filterRowFromEvent(e, today), state),
  );
  return eventsCalendar(matching, now, isEmptyFilter(state) ? 'events' : 'filtered events');
}
