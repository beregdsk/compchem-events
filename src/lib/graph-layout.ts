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
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Graph, GraphEdge } from './graph';

export type SimNode = SimulationNodeDatum & { id: string };
export type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

const SEED = 0x5eed;
/** Enough for 20–100 nodes to settle; checked by eye on the real data. */
const TICKS = 300;
/** viewBox margin. Labels only appear on hover, and flip left near the right edge. */
const PAD = { left: 40, right: 40, top: 40, bottom: 40 };
/** Smallest viewBox, so a map of a handful of nodes is not scaled up to giant shapes. */
const MIN_SIZE = { width: 640, height: 400 };

/** Deterministic PRNG for d3's jiggle and tie-breaking. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32;
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
  // Labels are hidden until hover, so nodes only need room for their shapes.
  return forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(lcg(SEED))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(35)
        .strength((l) => Math.min(1, l.weight * 1.5)),
    )
    .force('charge', forceManyBody<SimNode>().strength(-90).distanceMax(250))
    .force('x', forceX<SimNode>(0).strength(0.04))
    .force('y', forceY<SimNode>(0).strength(0.06))
    .force('collide', forceCollide<SimNode>(16))
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

export function layoutGraph(graph: Graph): Layout {
  if (graph.nodes.length === 0) return { positions: [], viewBox: [0, 0, 1, 1] };
  const nodes: SimNode[] = graph.nodes.map((n) => ({ id: n.id }));
  createSimulation(nodes, graph.edges).tick(TICKS);

  const positions = nodes.map((n) => ({ id: n.id, x: round(n.x!), y: round(n.y!) }));
  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  let minX = Math.min(...xs) - PAD.left;
  let minY = Math.min(...ys) - PAD.top;
  const fitWidth = Math.max(...xs) + PAD.right - minX;
  const fitHeight = Math.max(...ys) + PAD.bottom - minY;
  // Grow a small box around its centre.
  const width = Math.max(fitWidth, MIN_SIZE.width);
  const height = Math.max(fitHeight, MIN_SIZE.height);
  minX = round(minX - (width - fitWidth) / 2);
  minY = round(minY - (height - fitHeight) / 2);
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
export function graphPayload(graph: Graph, layout: Layout): string {
  const payload: GraphPayload = { nodes: layout.positions, edges: graph.edges };
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
