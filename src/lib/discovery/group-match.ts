// Cheap, deterministic matching of names against the groups registry, run
// before any model or search call. Spec: groups-registry-design.md, step 2.
import { normaliseGroupName } from '../group-validation';
import type { RawEvent, RawGroup, RawPosition } from '../types';
import type { GroupLead } from './parsers/group-listing';

/** Hosts that hold a person's profile, never a group's own website. */
export const PROFILE_HOSTS =
  /(^|\.)(scholar\.google\.[a-z.]+|researchgate\.net|linkedin\.com|orcid\.org|x\.com|twitter\.com)$/i;

export function isProfileHost(url: string): boolean {
  try {
    return PROFILE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Hosts that describe or hold a body's code without being its own website.
 * Search often cites them first; `*.github.io` lab pages stay allowed.
 */
export const REFERENCE_HOSTS = /(^|\.)(wikipedia\.org|wikidata\.org|github\.com)$/i;

/** A URL that may be a group's `website`: not a profile page nor a reference site. */
export function canBeGroupWebsite(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return !PROFILE_HOSTS.test(host) && !REFERENCE_HOSTS.test(host);
  } catch {
    return false;
  }
}

/** Splits on `;` and `,` outside parentheses; a trailing `(…)` becomes the affiliation. */
export function splitOrganizer(text: string): Array<{ name: string; affiliation?: string }> {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === ',') && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length >= 2)
    .map((p) => {
      const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(p);
      return m && m[1] ? { name: m[1].trim(), affiliation: m[2]!.trim() } : { name: p };
    });
}

export interface RegistryIndex {
  /** Normalised name, alias or PI → group id. */
  byName: Map<string, string>;
}

export function buildRegistryIndex(groups: readonly RawGroup[]): RegistryIndex {
  const byName = new Map<string, string>();
  for (const g of groups) {
    for (const n of [g.name, ...(g.aliases ?? []), ...(g.pi ? [g.pi] : [])]) {
      byName.set(normaliseGroupName(n), g.id);
    }
  }
  return { byName };
}

/** Whole-name match only: "CECAM-DE-JUELICH" is not CECAM. */
export function matchName(index: RegistryIndex, name: string): string | undefined {
  return index.byName.get(normaliseGroupName(name));
}

export function leadsFromEvents(events: readonly RawEvent[]): GroupLead[] {
  return events
    .filter((e) => e.organizer)
    .map((e) => ({ text: e.organizer!, origin: e.url, fromListing: false }));
}

export function leadsFromPositions(positions: readonly RawPosition[]): GroupLead[] {
  return positions
    .filter((p) => p.group)
    .map((p) => ({ text: p.group!, context: p.institution, origin: p.url, fromListing: false }));
}
