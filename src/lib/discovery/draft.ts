import { stringify } from 'yaml';
import type { ISODate } from '../dates';
import type { RawEvent } from '../types';

/** ASCII, lowercase, hyphen-separated — matches the event id schema pattern. */
export function slugifyTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface DraftInput {
  title: string;
  type: RawEvent['type'];
  start_date: ISODate;
  end_date: ISODate;
  format: RawEvent['format'];
  location?: RawEvent['location'];
  url: string;
  source_url: string;
  organizer?: string;
  topics: string[];
  description: string;
}

/**
 * Builds a structurally complete `RawEvent` from extracted fields: `id` from
 * title + start year, `added`/`last_verified` set to the run date. This is
 * exactly what the later, separate PR-opening step would set anyway — see
 * docs/superpowers/specs/2026-09-23-discovery-source-parsing-design.md,
 * "Validation and the candidate draft".
 */
export function synthesizeDraft(input: DraftInput, today: ISODate): RawEvent {
  const year = input.start_date.slice(0, 4);
  const draft: RawEvent = {
    id: `${slugifyTitle(input.title)}-${year}`,
    title: input.title,
    type: input.type,
    start_date: input.start_date,
    end_date: input.end_date,
    format: input.format,
    url: input.url,
    source_url: input.source_url,
    topics: input.topics,
    description: input.description,
    added: today,
    last_verified: today,
  };
  if (input.location) draft.location = input.location;
  if (input.organizer) draft.organizer = input.organizer;
  return draft;
}

/**
 * The file path a draft would occupy if it were written to `data/events/`,
 * derived from the draft's own `id`/`start_date` — never from where it was
 * found. `src/lib/validation.ts`'s semantic rule 1 checks the file's
 * basename and parent folder against `id` and the start year, so this path
 * must always agree with the draft that produced it.
 */
export function draftFilePath(draft: RawEvent): string {
  return `data/events/${draft.start_date.slice(0, 4)}/${draft.id}.yaml`;
}

/** Renders a draft as the YAML text a PR would commit at `draftFilePath(draft)`. */
export function serializeDraft(draft: RawEvent): string {
  return stringify(draft);
}
