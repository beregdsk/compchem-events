import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseISODate } from '../dates';
import type { Problem } from '../validation';

export const SOURCE_KINDS = [
  'listing-page',
  'inline-listing',
  'cecam-api',
  'event-page',
  'rss',
  'ical',
  'mailing-list-archive',
  'mailbox',
  'telegram-channel',
  'aggregator',
  'group-listing',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
  name: string;
  url: string;
  kind: SourceKind;
  /** `kind: 'mailbox'` only: the IMAP folder to read. Defaults to `discovery` (see `pipeline.ts`). */
  folder?: string;
  added?: string;
  last_checked?: string;
  notes?: string;
}

function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

function isSource(entry: unknown): entry is Source {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.name !== 'string' || typeof e.url !== 'string' || !isSourceKind(e.kind))
    return false;
  return e.folder === undefined || typeof e.folder === 'string';
}

/** Loads and filters `data/sources.yaml`. Malformed entries are skipped, never thrown on. */
export function loadSources(path = 'data/sources.yaml'): Source[] {
  const data: unknown = parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data)) return [];
  return data.filter(isSource);
}

const SOURCE_FIELDS = new Set(['name', 'url', 'kind', 'folder', 'added', 'last_checked', 'notes']);

function isISODate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Every problem in a parsed `data/sources.yaml`. `loadSources` skips a bad
 * entry silently at run time, so this is the check that stops one landing:
 * `npm run validate` runs it. `last_checked` is required because the file's
 * own rule is that nothing goes in unfetched.
 */
export function validateSources(data: unknown, file = 'data/sources.yaml'): Problem[] {
  if (!Array.isArray(data))
    return [{ file, field: '(root)', message: 'must be a list of sources' }];
  const problems: Problem[] = [];
  const firstWithUrl = new Map<string, number>();

  data.forEach((entry: unknown, i) => {
    const report = (field: string, message: string) =>
      problems.push({ file, field: `${i}/${field}`, message });
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      report('', 'must be a mapping');
      return;
    }
    const e = entry as Record<string, unknown>;

    for (const key of Object.keys(e)) if (!SOURCE_FIELDS.has(key)) report(key, 'unknown field');
    if (typeof e.name !== 'string' || e.name.trim() === '') report('name', 'required');
    if (!isSourceKind(e.kind)) report('kind', `must be one of ${SOURCE_KINDS.join(', ')}`);
    if (!isHttpsUrl(e.url)) {
      report('url', 'required, an https:// URL');
    } else {
      const first = firstWithUrl.get(e.url);
      if (first === undefined) firstWithUrl.set(e.url, i);
      else report('url', `same url as entry ${first}`);
    }
    if (e.folder !== undefined && (typeof e.folder !== 'string' || e.kind !== 'mailbox')) {
      report('folder', 'must be a string, and only on kind: mailbox');
    }
    if (!isISODate(e.last_checked)) report('last_checked', 'required, a YYYY-MM-DD date');
    if (e.added !== undefined && !isISODate(e.added)) report('added', 'must be a YYYY-MM-DD date');
    if (e.notes !== undefined && typeof e.notes !== 'string') report('notes', 'must be a string');
  });
  return problems;
}
