/** A calendar date in ISO `YYYY-MM-DD` form. Always interpreted as UTC. */
export type ISODate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parse an ISO calendar date to epoch milliseconds at UTC midnight.
 * Throws rather than coercing, so bad data fails the build loudly.
 */
export function parseISODate(s: string): number {
  const m = ISO_DATE.exec(s);
  if (!m) throw new RangeError(`not an ISO YYYY-MM-DD date: ${JSON.stringify(s)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  // Date.UTC rolls 2026-02-30 forward to 2026-03-02 instead of failing, so
  // round-trip the components to reject dates that do not exist.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`date does not exist: ${s}`);
  }
  return ms;
}

export function toISODate(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return toISODate(parseISODate(d) + n * MS_PER_DAY);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to) - parseISODate(from)) / MS_PER_DAY);
}

export function compareISO(a: ISODate, b: ISODate): number {
  // ISO dates are lexicographically ordered, so string comparison is correct
  // and avoids parsing in hot sort paths.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The current UTC calendar date. Inject `now` in tests. */
export function todayUTC(now: Date = new Date()): ISODate {
  return now.toISOString().slice(0, 10);
}
