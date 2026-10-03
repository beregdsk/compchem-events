import type { ISODate } from '../dates';
import { normaliseGroupName } from '../group-validation';
import type { RawGroup } from '../types';
import { slugifyTitle } from './draft';
import type { ExtractedGroup } from './group-extract';

export function groupFilePath(g: RawGroup): string {
  return `data/groups/${g.id}.yaml`;
}

/**
 * The text a lead was found as is often a page title or an address line
 * ("Lindh Group – Department of Chemistry – Uppsala University", "X Group,
 * Department of Physics, Okayama University, Japan"), which is no alias.
 */
export function looksLikeAName(text: string): boolean {
  return text.length <= 80 && !/[|,｜]|\s[–—-]\s/.test(text);
}

/** A registry draft from a verified homepage. `matchedText` becomes an alias when it is a new name. */
export function synthesizeGroupDraft(
  fields: ExtractedGroup,
  website: string,
  matchedText: string,
  takenIds: ReadonlySet<string>,
  today: ISODate,
): RawGroup {
  // slugifyTitle's fallback for a name with no Latin or Cyrillic letters is
  // `event-<hash>`; only that fallback is renamed, not a name like "Event Horizon Lab".
  const base = slugifyTitle(fields.name).replace(/^event-(?=[0-9a-f]{8}$)/, 'group-');
  let id = base;
  for (let n = 2; takenIds.has(id); n++) id = `${base}-${n}`;
  const draft: RawGroup = {
    id,
    name: fields.name,
    kind: fields.kind,
    website,
    topics: fields.topics,
    description: fields.description,
    added: today,
  };
  const known = [fields.name, fields.pi ?? ''].filter(Boolean).map(normaliseGroupName);
  if (looksLikeAName(matchedText) && !known.includes(normaliseGroupName(matchedText))) {
    draft.aliases = [matchedText];
  }
  if (fields.pi) draft.pi = fields.pi;
  if (fields.parent) draft.parent = fields.parent;
  if (fields.location) draft.location = fields.location;
  return draft;
}
