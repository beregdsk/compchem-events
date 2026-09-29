// Similarity between events, and the graph built from it, for the graph view
// at /graph/. Pure: no DOM, no layout. Spec: docs/superpowers/specs/
// 2026-09-28-event-graph-design.md.
import type { ISODate } from './dates';
import type { DerivedStatus, EventType, LoadedEvent } from './types';

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

export interface GraphNode {
  id: string;
  title: string;
  type: EventType;
  status: DerivedStatus;
  start_date: ISODate;
  end_date: ISODate;
  href: string;
}

/** Undirected; `source` precedes `target` in the input order. */
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface EventGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Links every pair scoring at least `EDGE_THRESHOLD`, plus each event's single
 * best link below it, so an event that resembles anything at all is never
 * drawn alone. An event sharing nothing with any other stays unlinked.
 */
export function buildEventGraph(events: LoadedEvent[]): EventGraph {
  const nodes: GraphNode[] = events.map((e) => ({
    id: e.id,
    title: e.title,
    type: e.type,
    status: e.status_derived,
    start_date: e.start_date,
    end_date: e.end_date,
    href: `/events/${e.id}/`,
  }));

  const kept = new Map<string, GraphEdge>();
  const best: { j: number; weight: number }[] = [];
  const add = (i: number, j: number, weight: number) => {
    kept.set(`${i}|${j}`, { source: events[i]!.id, target: events[j]!.id, weight });
  };

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const weight = similarity(events[i]!, events[j]!);
      if (weight <= 0) continue;
      if (weight > (best[i]?.weight ?? 0)) best[i] = { j, weight };
      if (weight > (best[j]?.weight ?? 0)) best[j] = { j: i, weight };
      if (weight >= EDGE_THRESHOLD) add(i, j, weight);
    }
  }
  best.forEach((b, i) => {
    if (b) add(Math.min(i, b.j), Math.max(i, b.j), b.weight);
  });

  const order = (k: string) => k.split('|').map(Number) as [number, number];
  const edges = [...kept.entries()]
    .sort(([a], [b]) => {
      const [a0, a1] = order(a);
      const [b0, b1] = order(b);
      return a0 - b0 || a1 - b1;
    })
    .map(([, e]) => e);

  return { nodes, edges };
}

/**
 * Ids of the events linked to `id` on the map, strongest link first, ties by
 * title. Event pages list these as related events, so a page and the map
 * never disagree about what is related.
 */
export function relatedEvents(graph: EventGraph, id: string): string[] {
  const titles = new Map(graph.nodes.map((n) => [n.id, n.title]));
  return graph.edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => ({ id: e.source === id ? e.target : e.source, weight: e.weight }))
    .sort((a, b) => b.weight - a.weight || titles.get(a.id)!.localeCompare(titles.get(b.id)!))
    .map((r) => r.id);
}
