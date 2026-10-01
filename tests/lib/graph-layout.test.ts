import { describe, expect, it } from 'vitest';
import type { Graph } from '../../src/lib/graph';
import { graphPayload, layoutGraph } from '../../src/lib/graph-layout';

const node = (id: string, title = id) => ({
  id,
  title,
  href: `/events/${id}/`,
  shape: 'square' as const,
  dimmed: false,
});

const graph: Graph = {
  nodes: ['a', 'b', 'c', 'd', 'lonely'].map((id) => node(id)),
  edges: [
    { source: 'a', target: 'b', weight: 0.6 },
    { source: 'b', target: 'c', weight: 0.4 },
    { source: 'c', target: 'd', weight: 0.12 },
  ],
};

describe('layoutGraph', () => {
  it('is deterministic', () => {
    expect(layoutGraph(graph)).toEqual(layoutGraph(graph));
  });

  it('places every node at a finite point inside the viewBox', () => {
    const { positions, viewBox } = layoutGraph(graph);
    const [x, y, w, h] = viewBox;
    expect(positions.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'lonely']);
    for (const p of positions) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThan(x);
      expect(p.x).toBeLessThan(x + w);
      expect(p.y).toBeGreaterThan(y);
      expect(p.y).toBeLessThan(y + h);
    }
  });

  it('pulls strongly linked events closer than unlinked ones', () => {
    const { positions } = layoutGraph(graph);
    const at = new Map(positions.map((p) => [p.id, p]));
    const dist = (a: string, b: string) =>
      Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'lonely'));
  });

  it('handles a single node', () => {
    const { positions, viewBox } = layoutGraph({ nodes: [node('solo')], edges: [] });
    expect(positions).toHaveLength(1);
    expect(viewBox[2]).toBeGreaterThan(0);
    expect(viewBox[3]).toBeGreaterThan(0);
  });

  it('keeps a small map at its minimum size, centred on the nodes', () => {
    const { positions, viewBox } = layoutGraph({ nodes: [node('solo')], edges: [] });
    const [minX, minY, width, height] = viewBox;
    expect([width, height]).toEqual([640, 400]);
    expect(minX + width / 2).toBeCloseTo(positions[0]!.x, 0);
    expect(minY + height / 2).toBeCloseTo(positions[0]!.y, 0);
  });

  it('handles no nodes', () => {
    expect(layoutGraph({ nodes: [], edges: [] }).positions).toEqual([]);
  });
});

describe('graphPayload', () => {
  it('round-trips positions and edges', () => {
    const layout = layoutGraph(graph);
    const parsed = JSON.parse(graphPayload(graph, layout));
    expect(parsed.nodes).toEqual(layout.positions);
    expect(parsed.edges).toEqual(graph.edges);
  });

  it('cannot close the script tag it is embedded in', () => {
    const hostile: Graph = { nodes: [node('x</script><b>')], edges: [] };
    const json = graphPayload(hostile, layoutGraph(hostile));
    expect(json).not.toContain('<');
    expect(JSON.parse(json).nodes[0].id).toBe('x</script><b>');
  });
});
