// The positions loader: reads data/positions/, validates it (invalid data
// fails the build, as for events) and derives each position's status from
// the build date. Spec: docs/superpowers/specs/2026-09-29-positions-design.md.
import { compareISO, daysBetween, todayUTC, type ISODate } from './dates';
import { formatProblems, loadValidationContext, type ValidationResult } from './validation';
import {
  POSITIONS_DIR,
  readPositionFiles,
  validatePosition,
  validatePositionCollection,
} from './position-validation';
import type { LoadedPosition, PositionStatus, RawPosition } from './types';

/** A position with no deadline is marked "may already be filled" from this age. */
export const STALE_AFTER_DAYS = 45;
/** ...and leaves the page for the archive at this age. */
export const ARCHIVE_AFTER_DAYS = 90;

export function positionStatus(p: RawPosition, today: ISODate): PositionStatus {
  if (p.deadline) return compareISO(p.deadline, today) < 0 ? 'archived' : 'open';
  const age = daysBetween(p.added, today);
  if (age >= ARCHIVE_AFTER_DAYS) return 'archived';
  return age >= STALE_AFTER_DAYS ? 'stale' : 'open';
}

export interface PositionLoadOptions {
  /** Directory holding `<year>/<id>.yaml`. Defaults to `data/positions`. */
  positionsDir?: string;
  /** The build date, as a UTC calendar date. Defaults to today. */
  today?: ISODate;
  /** Defaults to false in production builds, true otherwise. */
  includeFixtures?: boolean;
}

export function loadPositions(options: PositionLoadOptions = {}): LoadedPosition[] {
  const today = options.today ?? todayUTC();
  const includeFixtures = options.includeFixtures ?? process.env.NODE_ENV !== 'production';
  const entries = readPositionFiles(options.positionsDir ?? POSITIONS_DIR);
  const ctx = loadValidationContext('.', today);
  const all: ValidationResult = { errors: [], warnings: [] };
  for (const entry of entries) {
    const r = validatePosition(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  all.errors.push(...validatePositionCollection(entries).errors);
  if (all.errors.length > 0) {
    throw new Error(`position data validation failed:\n${formatProblems(all)}`);
  }
  for (const w of all.warnings) console.warn(`WARN ${w.file}: ${w.field}: ${w.message}`);

  return entries
    .map((entry) => entry.data as RawPosition)
    .filter((p) => includeFixtures || p.fixture !== true)
    .map((p) => ({
      ...p,
      status_derived: positionStatus(p, today),
      age_days: daysBetween(p.added, today),
    }));
}

const newestFirst = (a: LoadedPosition, b: LoadedPosition) =>
  compareISO(b.added, a.added) || a.title.localeCompare(b.title);

export function openPositions(ps: LoadedPosition[]): LoadedPosition[] {
  const open = ps.filter((p) => p.status_derived === 'open');
  const dated = open
    .filter((p) => p.deadline)
    .sort((a, b) => compareISO(a.deadline!, b.deadline!) || a.title.localeCompare(b.title));
  return [...dated, ...open.filter((p) => !p.deadline).sort(newestFirst)];
}

export function stalePositions(ps: LoadedPosition[]): LoadedPosition[] {
  return ps.filter((p) => p.status_derived === 'stale').sort(newestFirst);
}

export function archivedPositions(ps: LoadedPosition[]): LoadedPosition[] {
  return ps.filter((p) => p.status_derived === 'archived').sort(newestFirst);
}
