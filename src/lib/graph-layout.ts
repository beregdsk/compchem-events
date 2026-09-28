// Force layout for the graph view. Runs at build time, like orbital.ts, so the
// page ships a finished picture that works without JavaScript; the client
// script (src/scripts/graph.ts) reuses `createSimulation` to take over from
// the same positions, so the two never disagree about the forces. Seeded, so
// a rebuild reproduces the same layout and the output does not churn.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Force,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { EventGraph, GraphEdge } from './event-graph';

export type SimNode = SimulationNodeDatum & { id: string };
export type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

const SEED = 0x5eed;
/** Enough for 20–100 nodes to settle; checked by eye on the real data. */
const TICKS = 300;
/** viewBox margin; the right side leaves room for labels. */
const PAD = { left: 40, right: 220, top: 40, bottom: 40 };
/** Approximate extent of a node's label (28 characters at 13px), in simulation units. */
export const LABEL_WIDTH = 190;
export const LABEL_HEIGHT = 20;

/** Deterministic PRNG for d3's jiggle and tie-breaking. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32;
}

/**
 * Circular collision can't see labels: they are wide, short and run to the
 * right of their node, so two nodes a comfortable circle apart can still print
 * one title over another. This pushes such pairs apart vertically — the cheap
 * direction, since stacking rows costs far less room than spreading columns.
 */
function forceLabelGap(): Force<SimNode, SimLink> {
  let nodes: SimNode[] = [];
  // Like forceCollide, not scaled by alpha: an overlap is resolved in full
  // however cool the simulation is, or the link forces win as it settles.
  const force = () => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x! - a.x!;
        const dy = b.y! - a.y!;
        if (Math.abs(dx) >= LABEL_WIDTH || Math.abs(dy) >= LABEL_HEIGHT) continue;
        const push = (LABEL_HEIGHT - Math.abs(dy)) * 0.5 * (dy < 0 ? -1 : 1);
        a.vy! -= push;
        b.vy! += push;
      }
    }
  };
  force.initialize = (n: SimNode[]) => {
    nodes = n;
  };
  return force;
}

export function createSimulation(
  nodes: SimNode[],
  edges: GraphEdge[],
): Simulation<SimNode, SimLink> {
  const links: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    weight: e.weight,
  }));
  // Short-range repulsion (charge with distanceMax): enough to part neighbours,
  // not enough to fling clusters apart, so related events stay together.
  return forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(lcg(SEED))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(60)
        .strength((l) => Math.min(1, l.weight * 1.5)),
    )
    .force('charge', forceManyBody<SimNode>().strength(-300).distanceMax(400))
    .force('x', forceX<SimNode>(0).strength(0.1))
    .force('y', forceY<SimNode>(0).strength(0.1))
    .force('collide', forceCollide<SimNode>(42))
    .force('labels', forceLabelGap())
    .stop();
}

export interface Position {
  id: string;
  x: number;
  y: number;
}

export interface Layout {
  positions: Position[];
  /** `[minX, minY, width, height]`, in simulation units. */
  viewBox: [number, number, number, number];
}

const round = (n: number) => Math.round(n * 10) / 10;

export function layoutGraph(graph: EventGraph): Layout {
  if (graph.nodes.length === 0) return { positions: [], viewBox: [0, 0, 1, 1] };
  const nodes: SimNode[] = graph.nodes.map((n) => ({ id: n.id }));
  createSimulation(nodes, graph.edges).tick(TICKS);

  const positions = nodes.map((n) => ({ id: n.id, x: round(n.x!), y: round(n.y!) }));
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const minX = Math.min(...xs) - PAD.left;
  const minY = Math.min(...ys) - PAD.top;
  const width = Math.max(...xs) + PAD.right - minX;
  const height = Math.max(...ys) + PAD.bottom - minY;
  return { positions, viewBox: [minX, minY, width, height] };
}

export interface GraphPayload {
  nodes: Position[];
  edges: GraphEdge[];
}

/**
 * The client's starting state, as JSON safe to inline in a `<script>` tag:
 * `<` is escaped so no string in the data can close the tag.
 */
export function graphPayload(graph: EventGraph, layout: Layout): string {
  const payload: GraphPayload = { nodes: layout.positions, edges: graph.edges };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
