import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import type { ISODate } from './dates';
import { compareISO, daysBetween, todayUTC } from './dates';
import { regionOf } from './regions';
import type { RawEvent, Topic } from './types';

/** Lowercase, strip punctuation, collapse whitespace — for duplicate detection. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

export function isBlocked(url: string, blocked: ReadonlySet<string>): boolean {
  const host = hostOf(url);
  if (!host) return false;
  for (const domain of blocked) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function semanticRules(entry: EventFile, ctx: ValidationContext, out: ValidationResult): void {
  const e = entry.data as RawEvent;
  const err = (field: string, message: string) =>
    out.errors.push({ file: entry.file, field, message });
  const warn = (field: string, message: string) =>
    out.warnings.push({ file: entry.file, field, message });

  // Rule 1: id, file name and year agree.
  const stem = basename(entry.file, '.yaml');
  const folder = basename(dirname(entry.file));
  const startYear = e.start_date.slice(0, 4);
  if (e.id !== stem) err('id', `id "${e.id}" must equal the file name stem "${stem}"`);
  if (!e.id.endsWith(`-${startYear}`)) {
    err('id', `id must end with the start_date year "${startYear}"`);
  }
  if (folder !== startYear) {
    err('start_date', `file must sit in the folder for its start year, data/events/${startYear}/`);
  }

  // Rule 2: end_date on or after start_date.
  if (compareISO(e.end_date, e.start_date) < 0) {
    err('end_date', `end_date ${e.end_date} is before start_date ${e.start_date}`);
  }

  // Rule 3: added and last_verified are sane.
  if (compareISO(e.last_verified, ctx.today) > 0) {
    err('last_verified', `last_verified ${e.last_verified} is in the future`);
  }
  if (compareISO(e.added, ctx.today) > 0) {
    err('added', `added ${e.added} is in the future`);
  }
  if (compareISO(e.added, e.last_verified) > 0) {
    err('added', `added ${e.added} is after last_verified ${e.last_verified}`);
  }

  // Rule 4: topics and country are known.
  for (const t of e.topics) {
    if (!ctx.topics.has(t)) err('topics', `unknown topic "${t}"; add it to data/topics.yaml first`);
  }
  if (e.location && !regionOf(e.location.country)) {
    err(
      'location/country',
      `country "${e.location.country}" is not in the region table; add it to src/lib/regions.ts`,
    );
  }

  // Rule 6: urls are https and not blocked. (https is enforced by the schema.)
  for (const field of ['url', 'source_url'] as const) {
    const value = e[field];
    if (value && isBlocked(value, ctx.blockedHosts)) {
      err(field, `host of ${field} is on the blocklist in data/blocklist.yaml`);
    }
  }

  // Rule 7: no deadline after end_date.
  for (const d of e.deadlines ?? []) {
    if (compareISO(d.date, e.end_date) > 0) {
      err('deadlines', `${d.type} deadline ${d.date} falls after end_date ${e.end_date}`);
    }
  }

  // Rule 9: each deadline type appears at most once per event.
  // Stated at docs/data-schema.md:38 but absent from that document's own
  // enumerated error list, and not expressible in the JSON Schema because it is
  // a cross-item constraint. Without it, duplicate deadline types ship unvalidated.
  const seenDeadlineTypes = new Set<string>();
  for (const d of e.deadlines ?? []) {
    if (seenDeadlineTypes.has(d.type)) {
      err(
        'deadlines',
        `deadline type "${d.type}" appears more than once; each type is allowed at most once per event`,
      );
    }
    seenDeadlineTypes.add(d.type);
  }

  // Rule 8: location required unless online.
  if (e.format !== 'online' && !e.location) {
    err('location', `location is required when format is "${e.format}"`);
  }

  // Warning 1: a deadline after the start date.
  for (const d of e.deadlines ?? []) {
    if (compareISO(d.date, e.start_date) > 0 && compareISO(d.date, e.end_date) <= 0) {
      warn('deadlines', `${d.type} deadline ${d.date} falls after the start date`);
    }
  }

  // Warning 2: stale verification for an event that has not started.
  if (compareISO(e.start_date, ctx.today) > 0 && daysBetween(e.last_verified, ctx.today) > 90) {
    warn('last_verified', `last verified more than 90 days ago (${e.last_verified})`);
  }

  // Warning 3: the description looks copied.
  if (e.description.length > 200 && !e.description.includes('.')) {
    warn('description', 'description looks copied: over 200 characters with no full stop');
  }

  // Warning 4: a bare homepage usually means the event page is not ready.
  try {
    const u = new URL(e.url);
    if (u.pathname === '/' && !u.search) {
      warn('url', 'url is a bare homepage with no path; link the event page if one exists');
    }
  } catch {
    // Malformed URLs are already a schema error.
  }
}

export interface Problem {
  /** Path of the offending file, relative to the repo root. */
  file: string;
  /** Field path inside the file, e.g. `location/country`. */
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: Problem[];
  warnings: Problem[];
}

export interface ValidationContext {
  topics: ReadonlySet<string>;
  blockedHosts: ReadonlySet<string>;
  today: ISODate;
}

export interface EventFile {
  file: string;
  data: unknown;
}

interface BlocklistEntry {
  domain: string;
}

let compiled: ValidateFunction | undefined;

function schemaValidator(root: string): ValidateFunction {
  if (!compiled) {
    // strictRequired disabled: schema/event.schema.json's allOf/if/then requires
    // `status_note`, a property declared in the parent object's `properties`
    // rather than repeated inside the `then` branch. That is valid JSON Schema,
    // but Ajv's strictRequired check only looks at the local subschema and
    // throws on it. Every other strict-mode check stays enabled.
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    addFormats(ajv);
    compiled = ajv.compile(
      JSON.parse(readFileSync(join(root, 'schema/event.schema.json'), 'utf8')),
    );
  }
  return compiled;
}

export function loadValidationContext(root = '.', today: ISODate = todayUTC()): ValidationContext {
  const topics = parse(readFileSync(join(root, 'data/topics.yaml'), 'utf8')) as Topic[] | null;
  const blocklist = parse(readFileSync(join(root, 'data/blocklist.yaml'), 'utf8')) as
    BlocklistEntry[] | null;
  return {
    topics: new Set((topics ?? []).map((t) => t.slug)),
    blockedHosts: new Set((blocklist ?? []).map((b) => b.domain.toLowerCase())),
    today,
  };
}

export function validateEvent(entry: EventFile, ctx: ValidationContext): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };
  const validate = schemaValidator('.');

  if (!validate(entry.data)) {
    for (const err of validate.errors ?? []) {
      const field = err.instancePath.replace(/^\//, '') || err.params?.missingProperty || '(root)';
      result.errors.push({
        file: entry.file,
        field: String(field),
        message: err.message ?? 'schema violation',
      });
    }
    // Semantic rules assume a well-shaped object, so stop here.
    return result;
  }

  semanticRules(entry, ctx, result);
  return result;
}

export function validateCollection(
  entries: EventFile[],
  _ctx: ValidationContext,
): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const byId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byTitleDate = new Map<string, string>();
  const byDescription = new Map<string, string>();

  for (const entry of entries) {
    const e = entry.data as RawEvent;
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;

    const seenId = byId.get(e.id);
    if (seenId) {
      out.errors.push({
        file: entry.file,
        field: 'id',
        message: `duplicate id, also in ${seenId}`,
      });
    } else byId.set(e.id, entry.file);

    const url = e.url?.replace(/\/+$/, '');
    if (url) {
      const seenUrl = byUrl.get(url);
      if (seenUrl) {
        out.errors.push({
          file: entry.file,
          field: 'url',
          message: `duplicate url, also in ${seenUrl}`,
        });
      } else byUrl.set(url, entry.file);
    }

    const key = `${normaliseTitle(e.title ?? '')}|${e.start_date}`;
    const seenTitle = byTitleDate.get(key);
    if (seenTitle) {
      out.errors.push({
        file: entry.file,
        field: 'title',
        message: `duplicate title and start_date, also in ${seenTitle}`,
      });
    } else byTitleDate.set(key, entry.file);

    if (e.description) {
      const seenDesc = byDescription.get(e.description);
      if (seenDesc) {
        out.warnings.push({
          file: entry.file,
          field: 'description',
          message: `identical description to ${seenDesc}; write it in your own words`,
        });
      } else byDescription.set(e.description, entry.file);
    }
  }

  return out;
}

export function formatProblems(result: ValidationResult): string {
  const line = (p: Problem, kind: string) => `${kind} ${p.file}: ${p.field}: ${p.message}`;
  return [
    ...result.errors.map((p) => line(p, 'ERROR')),
    ...result.warnings.map((p) => line(p, 'WARN ')),
  ].join('\n');
}
