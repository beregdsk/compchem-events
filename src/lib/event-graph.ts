// Similarity between events, and the graph built from it, for the event map
// at /graph/. Pure: no DOM, no layout. Spec: docs/superpowers/specs/
// 2026-09-28-event-graph-design.md.
import type { LoadedEvent } from './types';

/** Weights of the three similarity signals. They sum to 1. */
export const TOPIC_WEIGHT = 0.6;
export const SERIES_WEIGHT = 0.25;
export const ORGANIZER_WEIGHT = 0.15;

/** Pairs scoring at least this are linked. */
export const EDGE_THRESHOLD = 0.35;

type Comparable = Pick<LoadedEvent, 'topics' | 'series' | 'organizer'>;

/**
 * Keys that identify an organizer across its spellings. `organizer` is free
 * text, so "CECAM", "CECAM-IT-SISSA" and "CECAM Beijing node" must all reduce
 * to `cecam`. Each `;`-separated co-organizer contributes its acronyms:
 * tokens of three or more characters with at least two capitals (CECAM, CCP5,
 * RSC, MolSSI, GDCh). Three characters, so the country codes in node names
 * (IT, NL, DE) don't link unrelated events. A part with no acronym
 * contributes its whole text.
 */
export function organizerKeys(organizer: string | undefined): Set<string> {
  const keys = new Set<string>();
  if (!organizer) return keys;
  for (const part of organizer.split(';')) {
    const text = part.trim();
    if (!text) continue;
    const acronyms = text
      .split(/[^A-Za-z0-9]+/)
      .filter((t) => t.length >= 3 && (t.match(/[A-Z]/g)?.length ?? 0) >= 2);
    if (acronyms.length === 0) keys.add(text.toLowerCase());
    for (const a of acronyms) keys.add(a.toLowerCase());
  }
  return keys;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** 0 (nothing in common) to 1. Symmetric. */
export function similarity(a: Comparable, b: Comparable): number {
  const topics = jaccard(new Set(a.topics), new Set(b.topics));
  const series = a.series !== undefined && a.series === b.series ? 1 : 0;
  const organizer = intersects(organizerKeys(a.organizer), organizerKeys(b.organizer)) ? 1 : 0;
  return Math.min(1, TOPIC_WEIGHT * topics + SERIES_WEIGHT * series + ORGANIZER_WEIGHT * organizer);
}

/** A node label: at most `max` code points, ending in `…` when cut. */
export function shortLabel(title: string, max = 28): string {
  const chars = [...title];
  if (chars.length <= max) return title;
  return (
    chars
      .slice(0, max - 1)
      .join('')
      .trimEnd() + '…'
  );
}
