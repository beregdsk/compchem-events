import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

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
