import type { ISODate } from '../dates';
import type { RawPosition } from '../types';
import { slugifyTitle } from './draft';
import type { ExtractedPosition } from './position-extract';

/** Longest slug kept before the `-<year>` suffix, so ids and branch names stay readable. */
const MAX_SLUG = 80;

/**
 * A structurally complete `RawPosition` from extracted fields. The id carries
 * the institution as well as the title, since adverts reuse generic titles
 * ("PhD position in computational chemistry") across institutions. `url`
 * falls back to the item it was found in, never to an invented link.
 */
export function synthesizePositionDraft(
  fields: ExtractedPosition,
  sourceUrl: string,
  topics: string[],
  today: ISODate,
): RawPosition {
  let slug = slugifyTitle(`${fields.institution} ${fields.title}`);
  if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG).replace(/-[^-]*$/, '');
  const draft: RawPosition = {
    id: `${slug}-${today.slice(0, 4)}`,
    title: fields.title,
    level: fields.level,
    institution: fields.institution,
    location: fields.location,
    url: fields.url ?? sourceUrl,
    source_url: sourceUrl,
    topics,
    description: fields.description,
    added: today,
  };
  if (fields.group) draft.group = fields.group;
  if (fields.deadline) draft.deadline = fields.deadline;
  return draft;
}

/** Where the draft lives once merged; agrees with position-validation's folder rule. */
export function positionFilePath(p: RawPosition): string {
  return `data/positions/${p.added.slice(0, 4)}/${p.id}.yaml`;
}
