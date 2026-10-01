// The graph shared by the three map views (events, positions, groups): nodes
// ready to draw, and edges between similar items. Pure: no DOM, no layout.
// Each directory supplies its own similarity; spec:
// docs/superpowers/specs/2026-09-28-event-graph-design.md.
import type { Shape } from './graph-shapes';

/** Pairs scoring at least this are linked. */
export const EDGE_THRESHOLD = 0.35;

export interface GraphNode {
  id: string;
  title: string;
  href: string;
  shape: Shape;
  /** Drawn faded: past events, archived positions. */
  dimmed: boolean;
}

/** Undirected; `source` precedes `target` in the input order. */
export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
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

/**
 * Links every pair scoring at least `EDGE_THRESHOLD`, plus each item's single
 * best link below it, so an item that resembles anything at all is never
 * drawn alone. An item sharing nothing with any other stays unlinked.
 */
export function linkSimilar<T extends { id: string }>(
  items: T[],
  similarity: (a: T, b: T) => number,
): GraphEdge[] {
  const kept = new Map<string, GraphEdge>();
  const best: { j: number; weight: number }[] = [];
  const add = (i: number, j: number, weight: number) => {
    kept.set(`${i}|${j}`, { source: items[i]!.id, target: items[j]!.id, weight });
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const weight = similarity(items[i]!, items[j]!);
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
  return [...kept.entries()]
    .sort(([a], [b]) => {
      const [a0, a1] = order(a);
      const [b0, b1] = order(b);
      return a0 - b0 || a1 - b1;
    })
    .map(([, e]) => e);
}
