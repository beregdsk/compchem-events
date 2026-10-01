// Similarity between events, and the graph built from it, for the graph view
// at /graph/. Pure: no DOM, no layout. Spec: docs/superpowers/specs/
// 2026-09-28-event-graph-design.md.
import { jaccard, linkSimilar, type Graph } from './graph';
import { shapeFor } from './graph-shapes';
import type { LoadedEvent } from './types';

/** Weights of the three similarity signals. They sum to 1. */
export const TOPIC_WEIGHT = 0.6;
export const SERIES_WEIGHT = 0.25;
export const ORGANIZER_WEIGHT = 0.15;

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

/** Past events are dimmed. */
export function buildEventGraph(events: LoadedEvent[]): Graph {
  return {
    nodes: events.map((e) => ({
      id: e.id,
      title: e.title,
      href: `/events/${e.id}/`,
      shape: shapeFor(e.type),
      dimmed: e.status_derived === 'past',
    })),
    edges: linkSimilar(events, similarity),
  };
}

/**
 * Ids of the events linked to `id` on the map, strongest link first, ties by
 * title. Event pages list these as related events, so a page and the map
 * never disagree about what is related.
 */
export function relatedEvents(graph: Graph, id: string): string[] {
  const titles = new Map(graph.nodes.map((n) => [n.id, n.title]));
  return graph.edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => ({ id: e.source === id ? e.target : e.source, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight || titles.get(a.id)!.localeCompare(titles.get(b.id)!))
    .map((r) => r.id);
}
