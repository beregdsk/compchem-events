// Kept free of node:fs so the Worker can import it alongside the filter.
import { compareISO, type ISODate } from './dates';
import type { RawEvent } from './types';

export function hasOpenDeadline(event: RawEvent, today: ISODate): boolean {
  return (event.deadlines ?? []).some((d) => compareISO(d.date, today) >= 0);
}

/** True when a travel-grant deadline is still open: the filter students ask for most. */
export function hasOpenTravelGrant(event: RawEvent, today: ISODate): boolean {
  return (event.deadlines ?? []).some(
    (d) => d.type === 'travel_grant' && compareISO(d.date, today) >= 0,
  );
}
