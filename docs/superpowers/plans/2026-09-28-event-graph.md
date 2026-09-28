# Event Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/graph/`, an Obsidian-style map where events that share topics, a series or an organizer are linked and cluster together, with drag, hover-highlight and pan/zoom, and a static fallback without JavaScript.

**Architecture:** A pure module scores event similarity and builds nodes/edges. A build-time wrapper runs a seeded d3-force simulation and yields positions plus a viewBox; the Astro page renders them as static SVG and embeds them as JSON. A client script reuses the same force configuration to take over from those positions.

**Tech Stack:** Astro 7 (static output), TypeScript strict, `d3-force` v3 (new), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-event-graph-design.md`

## Global Constraints

- Client JS minimal and progressive: `/graph/` must be readable and navigable with JS disabled (`AGENTS.md`).
- No runtime network calls, no CDN, no third-party scripts: d3-force is bundled by Astro (`AGENTS.md`, `TASK.md`).
- New dependency justified in writing: record it in `docs/decisions.md` (Task 3).
- All CSS lives in `src/styles/global.css`: the repo has no component `<style>` blocks.
- Pure logic in `src/lib/` with unit tests; pages stay thin (`AGENTS.md`).
- Dates are `ISODate` strings; never parse through the local timezone.
- Fixtures excluded: use `loadEvents()` with defaults, as other pages do.
- Accessibility: keyboard reachable nodes, visible focus, WCAG AA text contrast, `prefers-reduced-motion` honoured, usable at 360 px.
- Weights: topics `0.6`, series `0.25`, organizer `0.15`; edge threshold `0.35`; label truncation `28` characters; past shapes at `0.35` opacity; faded elements at `0.15` opacity.
- Definition of done: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build && npm run test:e2e` all pass.

## Review Focus

1. **Event title containing `</script>` or `<`**: the embedded JSON must not break out of its script tag. `graphPayload` escapes `<`; tested in Task 3.
2. **An event sharing nothing with any other event**: it must still render as a node and appear as a one-event cluster, not vanish. Tested in Task 2.
3. **Duplicate topics within one event, or an event with no topics**: Jaccard must use sets and return 0 for two empty sets, not `NaN`. Tested in Task 1.
4. **Dragging a node and releasing it over the same node**: the drag must not navigate to the event page. Tested in Task 5 (e2e).
5. **Non-ASCII or astral characters in long titles** (e.g. "Jülich"): truncation must count code points and never split a surrogate pair. Tested in Task 1.

Two deliberate deviations from the spec's wording, both recorded in the spec in Task 6:
- The organizer acronym rule also requires tokens of **at least 3 characters**. Country-code tokens in "CECAM-IT-SISSA" / "CECAM-NL" (IT, NL, DE) would otherwise create spurious links.
- `tests/pages/links.test.ts` is a source-grep test, not a built-page sweep, so it cannot check that node hrefs resolve. That check moves to e2e (Task 5), which requests every node's href against the production preview.

---

### Task 1: Similarity scoring

**Files:**
- Create: `src/lib/event-graph.ts`
- Test: `tests/lib/event-graph.test.ts`

**Interfaces:**
- Consumes: `LoadedEvent` from `src/lib/types.ts`.
- Produces:
  - `TOPIC_WEIGHT = 0.6`, `SERIES_WEIGHT = 0.25`, `ORGANIZER_WEIGHT = 0.15`, `EDGE_THRESHOLD = 0.35`
  - `organizerKeys(organizer: string | undefined): Set<string>`
  - `similarity(a: Comparable, b: Comparable): number`, where `type Comparable = Pick<LoadedEvent, 'topics' | 'series' | 'organizer'>`
  - `shortLabel(title: string, max?: number): string` (default `max = 28`)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/event-graph.test.ts
import { describe, expect, it } from 'vitest';
import { organizerKeys, shortLabel, similarity } from '../../src/lib/event-graph';

describe('organizerKeys', () => {
  it('reduces every CECAM node to the same key', () => {
    for (const name of ['CECAM', 'CECAM-IT-SISSA', 'CECAM Beijing node', 'CECAM-NL and the University of Amsterdam']) {
      expect(organizerKeys(name).has('cecam')).toBe(true);
    }
  });

  it('ignores two-letter country codes', () => {
    expect(organizerKeys('CECAM-IT-SISSA')).toEqual(new Set(['cecam', 'sissa']));
  });

  it('splits co-organizers on semicolons', () => {
    expect(organizerKeys('CCP5; RSC Statistical Mechanics & Thermodynamics Group')).toEqual(
      new Set(['ccp5', 'rsc']),
    );
  });

  it('finds a mixed-case acronym in parentheses', () => {
    expect(organizerKeys('Molecular Sciences Software Institute (MolSSI)')).toEqual(new Set(['molssi']));
  });

  it('falls back to the whole part when it has no acronym', () => {
    expect(organizerKeys('Telluride Science')).toEqual(new Set(['telluride science']));
  });

  it('is empty for a missing organizer', () => {
    expect(organizerKeys(undefined).size).toBe(0);
  });
});

describe('similarity', () => {
  const base = { topics: ['dft', 'excited-states'], series: undefined, organizer: undefined };

  it('scores identical topics alone at the topic weight', () => {
    expect(similarity(base, { ...base })).toBeCloseTo(0.6);
  });

  it('scores a shared series alone at the series weight', () => {
    expect(
      similarity({ topics: ['dft'], series: 'molsim' }, { topics: ['catalysis'], series: 'molsim' }),
    ).toBeCloseTo(0.25);
  });

  it('scores a shared organizer alone at the organizer weight', () => {
    expect(
      similarity(
        { topics: ['dft'], organizer: 'CECAM-IT-SISSA' },
        { topics: ['catalysis'], organizer: 'CECAM Beijing node' },
      ),
    ).toBeCloseTo(0.15);
  });

  it('is symmetric', () => {
    const a = { topics: ['dft', 'catalysis'], organizer: 'CCP5' };
    const b = { topics: ['dft'], organizer: 'CCP5; RSC Group' };
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a));
  });

  it('never exceeds 1', () => {
    const e = { topics: ['dft'], series: 's', organizer: 'CECAM' };
    expect(similarity(e, { ...e })).toBeLessThanOrEqual(1);
  });

  it('treats duplicate topics as a set', () => {
    expect(similarity({ topics: ['dft', 'dft'] }, { topics: ['dft'] })).toBeCloseTo(0.6);
  });

  it('is 0, not NaN, for two events with no topics', () => {
    expect(similarity({ topics: [] }, { topics: [] })).toBe(0);
  });
});

describe('shortLabel', () => {
  it('leaves a short title alone', () => {
    expect(shortLabel('Sanibel Symposium')).toBe('Sanibel Symposium');
  });

  it('truncates to the limit with an ellipsis', () => {
    const label = shortLabel('Total Energy and Force Methods Workshop 2027');
    expect([...label]).toHaveLength(28);
    expect(label.endsWith('…')).toBe(true);
  });

  it('counts code points, never splitting a surrogate pair', () => {
    const label = shortLabel('🧪'.repeat(40), 10);
    expect([...label]).toHaveLength(10);
    expect(label).toBe('🧪'.repeat(9) + '…');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/lib/event-graph.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/lib/event-graph".

- [ ] **Step 3: Implement**

```ts
// src/lib/event-graph.ts
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
  return chars.slice(0, max - 1).join('').trimEnd() + '…';
}
```

Note on the truncation test: the first 27 code points of `'Total Energy and Force Methods Workshop 2027'` are `Total Energy and Force Meth`, which ends in `h`, not a space, so `trimEnd` doesn't shorten it and the label is exactly 28 code points. If you change the fixture title, keep one whose 27th code point isn't a space.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/lib/event-graph.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-graph.ts tests/lib/event-graph.test.ts
git commit -m "feat(graph): score event similarity from topics, series and organizer"
```

---

### Task 2: Graph and clusters

**Files:**
- Modify: `src/lib/event-graph.ts` (append)
- Test: `tests/lib/event-graph.test.ts` (append)

**Interfaces:**
- Consumes: `similarity`, `EDGE_THRESHOLD` (Task 1); `LoadedEvent`, `EventType`, `DerivedStatus` from `types.ts`; `ISODate` from `dates.ts`.
- Produces:
  - `interface GraphNode { id: string; title: string; type: EventType; status: DerivedStatus; start_date: ISODate; end_date: ISODate; href: string }`
  - `interface GraphEdge { source: string; target: string; weight: number }`
  - `interface EventGraph { nodes: GraphNode[]; edges: GraphEdge[] }`
  - `buildEventGraph(events: LoadedEvent[]): EventGraph`
  - `clusters(graph: EventGraph): GraphNode[][]`

- [ ] **Step 1: Write the failing tests** (append to `tests/lib/event-graph.test.ts`, merging the imports)

```ts
import { buildEventGraph, clusters } from '../../src/lib/event-graph';
import type { LoadedEvent } from '../../src/lib/types';

const ev = (id: string, over: Partial<LoadedEvent> = {}): LoadedEvent =>
  ({
    id,
    title: id,
    type: 'workshop',
    start_date: '2027-01-10',
    end_date: '2027-01-12',
    format: 'online',
    url: `https://example.org/${id}/`,
    topics: ['dft'],
    description: 'd',
    added: '2026-09-20',
    last_verified: '2026-09-20',
    region: 'Online',
    status_derived: 'upcoming',
    ...over,
  }) as LoadedEvent;

const key = (e: { source: string; target: string }) => [e.source, e.target].sort().join('|');

describe('buildEventGraph', () => {
  it('makes one node per event, linking to its event page', () => {
    const g = buildEventGraph([ev('a'), ev('b', { status_derived: 'past' })]);
    expect(g.nodes.map((n) => [n.id, n.href, n.status])).toEqual([
      ['a', '/events/a/', 'upcoming'],
      ['b', '/events/b/', 'past'],
    ]);
  });

  it('links pairs at or above the threshold', () => {
    const g = buildEventGraph([ev('a'), ev('b')]); // identical topics: 0.6
    expect(g.edges.map(key)).toEqual(['a|b']);
  });

  it("keeps each node's best edge even below the threshold", () => {
    const g = buildEventGraph([
      ev('a', { topics: ['dft', 'catalysis', 'spectroscopy'] }),
      ev('b', { topics: ['dft', 'soft-matter', 'drug-design'] }), // jaccard 0.2 → 0.12
    ]);
    expect(g.edges.map(key)).toEqual(['a|b']);
    expect(g.edges[0]!.weight).toBeCloseTo(0.12);
  });

  it('leaves an event sharing nothing unlinked but present', () => {
    const g = buildEventGraph([ev('a'), ev('b'), ev('lonely', { topics: ['catalysis'] })]);
    expect(g.nodes.map((n) => n.id)).toContain('lonely');
    expect(g.edges.some((e) => e.source === 'lonely' || e.target === 'lonely')).toBe(false);
  });

  it('has no self-loops and no duplicate undirected edges', () => {
    const g = buildEventGraph([ev('a'), ev('b'), ev('c'), ev('d', { topics: ['catalysis', 'dft'] })]);
    expect(g.edges.every((e) => e.source !== e.target)).toBe(true);
    const keys = g.edges.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is empty for no events', () => {
    expect(buildEventGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe('clusters', () => {
  it('groups connected events, largest first, and keeps singletons', () => {
    const g = buildEventGraph([
      ev('a'),
      ev('b'),
      ev('c'),
      ev('x', { topics: ['catalysis'] }),
      ev('y', { topics: ['catalysis'] }),
      ev('lonely', { topics: ['soft-matter'] }),
    ]);
    expect(clusters(g).map((c) => c.map((n) => n.id).sort())).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y'],
      ['lonely'],
    ]);
  });

  it('orders events within a cluster newest first', () => {
    const g = buildEventGraph([
      ev('old', { start_date: '2024-01-01', end_date: '2024-01-02' }),
      ev('new', { start_date: '2027-01-01', end_date: '2027-01-02' }),
    ]);
    expect(clusters(g)[0]!.map((n) => n.id)).toEqual(['new', 'old']);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/lib/event-graph.test.ts`
Expected: FAIL, "buildEventGraph is not a function" (or an import error).

- [ ] **Step 3: Implement** (append to `src/lib/event-graph.ts`, and extend its imports)

```ts
import { compareISO, type ISODate } from './dates';
import type { DerivedStatus, EventType, LoadedEvent } from './types';

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
 * Connected components, largest first; within one, newest event first. The
 * event map lists these under the graph as its text equivalent.
 */
export function clusters(graph: EventGraph): GraphNode[][] {
  const adjacent = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    adjacent.get(e.source)!.push(e.target);
    adjacent.get(e.target)!.push(e.source);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const groups: GraphNode[][] = [];
  for (const start of graph.nodes) {
    if (seen.has(start.id)) continue;
    const group: GraphNode[] = [];
    const stack = [start.id];
    seen.add(start.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(byId.get(id)!);
      for (const next of adjacent.get(id)!) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    group.sort((a, b) => compareISO(b.start_date, a.start_date) || a.title.localeCompare(b.title));
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length || a[0]!.title.localeCompare(b[0]!.title));
}
```

Replace Task 1's `import type { LoadedEvent } from './types';` line with the two imports above; don't duplicate it.

In the best-edge test, check the arithmetic: the topic sets `{dft, catalysis, spectroscopy}` and `{dft, soft-matter, drug-design}` share 1 of 5, so Jaccard is 0.2 and the weight is 0.6 × 0.2 = 0.12.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/lib/event-graph.test.ts`
Expected: PASS, all tests from Tasks 1–2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/event-graph.ts tests/lib/event-graph.test.ts
git commit -m "feat(graph): build event graph with best-edge guarantee and clusters"
```

---

### Task 3: Seeded force layout and JSON payload

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `src/lib/graph-layout.ts`
- Test: `tests/lib/graph-layout.test.ts`
- Modify: `docs/decisions.md` (append the dependency justification)

**Interfaces:**
- Consumes: `EventGraph`, `GraphEdge` (Task 2).
- Produces:
  - `type SimNode = SimulationNodeDatum & { id: string }`
  - `type SimLink = SimulationLinkDatum<SimNode> & { weight: number }`
  - `createSimulation(nodes: SimNode[], edges: GraphEdge[]): Simulation<SimNode, SimLink>`: stopped, forces configured, seeded. Shared by the build and the client (Task 5).
  - `interface Position { id: string; x: number; y: number }`
  - `interface Layout { positions: Position[]; viewBox: [number, number, number, number] }`
  - `layoutGraph(graph: EventGraph): Layout`
  - `interface GraphPayload { nodes: Position[]; edges: GraphEdge[] }`
  - `graphPayload(graph: EventGraph, layout: Layout): string`: JSON that is safe to embed in a `<script>` tag.

- [ ] **Step 1: Install the dependency**

Run: `npm install d3-force@^3.0.0 && npm install -D @types/d3-force@^3.0.10`
Expected: both added to `package.json`; `npm ls d3-force` shows `d3-force@3.0.0`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/lib/graph-layout.test.ts
import { describe, expect, it } from 'vitest';
import type { EventGraph } from '../../src/lib/event-graph';
import { graphPayload, layoutGraph } from '../../src/lib/graph-layout';

const node = (id: string, title = id) => ({
  id,
  title,
  type: 'workshop' as const,
  status: 'upcoming' as const,
  start_date: '2027-01-10',
  end_date: '2027-01-12',
  href: `/events/${id}/`,
});

const graph: EventGraph = {
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
    const dist = (a: string, b: string) => Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
    expect(dist('a', 'b')).toBeLessThan(dist('a', 'lonely'));
  });

  it('handles a single node', () => {
    const { positions, viewBox } = layoutGraph({ nodes: [node('solo')], edges: [] });
    expect(positions).toHaveLength(1);
    expect(viewBox[2]).toBeGreaterThan(0);
    expect(viewBox[3]).toBeGreaterThan(0);
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
    const hostile: EventGraph = { nodes: [node('x</script><b>')], edges: [] };
    const json = graphPayload(hostile, layoutGraph(hostile));
    expect(json).not.toContain('<');
    expect(JSON.parse(json).nodes[0].id).toBe('x</script><b>');
  });
});
```

The payload carries ids, not titles: titles live in the static SVG, which Astro escapes. The hostile id exercises the same escaping any string would need.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/lib/graph-layout.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/lib/graph-layout".

- [ ] **Step 4: Implement**

```ts
// src/lib/graph-layout.ts
// Force layout for the event map. Runs at build time, like orbital.ts, so the
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
import type { EventGraph, GraphEdge } from './event-graph';

export type SimNode = SimulationNodeDatum & { id: string };
export type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

const SEED = 0x5eed;
/** Enough for 20–100 nodes to settle; checked by eye on the real data. */
const TICKS = 300;
/** viewBox margin; the right side leaves room for labels. */
const PAD = { left: 40, right: 220, top: 40, bottom: 40 };

/** Deterministic PRNG for d3's jiggle and tie-breaking. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32;
}

export function createSimulation(nodes: SimNode[], edges: GraphEdge[]): Simulation<SimNode, SimLink> {
  const links: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight }));
  return forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(lcg(SEED))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(70)
        .strength((l) => l.weight),
    )
    .force('charge', forceManyBody<SimNode>().strength(-240))
    .force('x', forceX<SimNode>(0).strength(0.06))
    .force('y', forceY<SimNode>(0).strength(0.06))
    .force('collide', forceCollide<SimNode>(26))
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/lib/graph-layout.test.ts`
Expected: PASS. If "pulls strongly linked events closer" fails, the forces are wrong: don't loosen the test, fix `createSimulation`.

- [ ] **Step 6: Record the dependency decision** (append to `docs/decisions.md`)

```markdown
## 2026-09-28 — Event map: d3-force

The event map (`/graph/`, spec `docs/superpowers/specs/2026-09-28-event-graph-design.md`)
adds `d3-force` v3 (ISC; pulls d3-dispatch, d3-quadtree, d3-timer; about
15 kB gzipped) and `@types/d3-force` as a devDependency. It is the standard,
small, maintained force-simulation implementation, and one dependency covers
both uses: the seeded layout at build time (`src/lib/graph-layout.ts`) and the
draggable simulation in the browser (`src/scripts/graph.ts`), which share one
force configuration. Astro bundles it into the page's own script — no CDN, no
runtime network calls. It loads only on `/graph/`, so the home page's 30 kB JS
budget is untouched. Pan and zoom are hand-rolled on the SVG viewBox rather than
adding d3-zoom.
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/graph-layout.ts tests/lib/graph-layout.test.ts docs/decisions.md
git commit -m "feat(graph): seeded d3-force layout and script-safe payload"
```

---

### Task 4: Static `/graph/` page

**Files:**
- Create: `src/lib/graph-shapes.ts`
- Test: `tests/lib/graph-shapes.test.ts`
- Create: `src/pages/graph.astro`
- Modify: `src/styles/global.css` (append an "Event map" section)
- Modify: `src/layouts/Base.astro` (footer "About" column, after the Sources link)
- Modify: `src/pages/sitemap.xml.ts:5` (add `'/graph/'` to `STATIC_PATHS`)
- Test: `tests/styles/contrast.test.ts` (append)

**Interfaces:**
- Consumes: `buildEventGraph`, `clusters`, `shortLabel` (Tasks 1–2); `layoutGraph`, `graphPayload` (Task 3); `loadEvents` (`events.ts`); `formatDateRange` (`dates.ts`).
- Produces the DOM contract that Task 5's client script and e2e tests rely on:
  - `figure.graph` wraps `svg#event-graph`, with `viewBox="minX minY w h"`
  - `svg#event-graph g.graph__edges line.graph__edge[data-source][data-target]`
  - `svg#event-graph a.graph-node[data-id][href]` with class `graph-node--past` or `graph-node--current`, containing `g.graph-node__body[transform="translate(x y)"]` > (`circle.graph-node__halo` if not past) + `path.graph-node__shape` + `text.graph-node__label[data-short][data-full]`
  - `script#event-graph-data[type="application/json"]` holding `graphPayload`
  - `ol.graph-clusters` with one `a` per event
  - `graph-shapes.ts`: `type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'ring'`, `NODE_RADIUS = 9`, `shapeFor(type: EventType): Shape`, `shapePath(shape: Shape, r?: number): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/graph-shapes.test.ts
import { describe, expect, it } from 'vitest';
import { shapeFor, shapePath } from '../../src/lib/graph-shapes';
import { EVENT_TYPES } from '../../src/lib/types';

describe('graph shapes', () => {
  it('gives every event type a shape', () => {
    for (const type of EVENT_TYPES) expect(shapeFor(type)).toBeTruthy();
  });

  it("draws the spec's mapping", () => {
    expect(
      ['conference', 'workshop', 'school', 'symposium', 'webinar', 'hackathon'].map((t) =>
        shapeFor(t as (typeof EVENT_TYPES)[number]),
      ),
    ).toEqual(['circle', 'square', 'diamond', 'triangle', 'ring', 'ring']);
  });

  it('returns a closed path for each shape', () => {
    for (const s of ['circle', 'square', 'diamond', 'triangle', 'ring'] as const) {
      expect(shapePath(s)).toMatch(/^M.*Z$/);
    }
  });
});
```

Append to `tests/styles/contrast.test.ts`, which reuses its existing `block` helper:

```ts
describe('event map', () => {
  // Past nodes dim their shape, never their label: a label at 35% opacity
  // would fail AA. The label instead uses --fg-muted, whose contrast against
  // --bg-raise (the graph's ground) is already asserted above.
  it('keeps past-event labels at full opacity in a tested colour', () => {
    const rule = block('.graph-node--past .graph-node__label {');
    expect(rule).toMatch(/fill:\s*var\(--fg-muted\)/);
    expect(rule).not.toMatch(/opacity/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/lib/graph-shapes.test.ts tests/styles/contrast.test.ts`
Expected: FAIL. The shapes import doesn't resolve, and `block` throws "no rule for .graph-node--past .graph-node__label {".

- [ ] **Step 3: Implement the shapes**

```ts
// src/lib/graph-shapes.ts
// Event type on the event map is carried by shape, not colour: the palette's
// two accents already mean "interactive" and "time", and a rainbow of types
// would dilute both. Paths are centred on the origin; the page translates them.
import type { EventType } from './types';

export type Shape = 'circle' | 'square' | 'diamond' | 'triangle' | 'ring';

export const NODE_RADIUS = 9;

const SHAPES: Record<EventType, Shape> = {
  conference: 'circle',
  workshop: 'square',
  school: 'diamond',
  symposium: 'triangle',
  webinar: 'ring',
  hackathon: 'ring',
};

export function shapeFor(type: EventType): Shape {
  return SHAPES[type];
}

const f = (n: number) => +n.toFixed(2);

/** Sized so each shape reads as roughly the same visual weight. */
export function shapePath(shape: Shape, r = NODE_RADIUS): string {
  switch (shape) {
    case 'circle':
    case 'ring':
      return `M${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    case 'square': {
      const s = f(r * 0.85);
      return `M${-s} ${-s}H${s}V${s}H${-s}Z`;
    }
    case 'diamond': {
      const d = f(r * 1.2);
      return `M0 ${-d}L${d} 0L0 ${d}L${-d} 0Z`;
    }
    case 'triangle':
      return `M0 ${f(-r * 1.15)}L${r} ${f(r * 0.75)}L${-r} ${f(r * 0.75)}Z`;
  }
}
```

- [ ] **Step 4: Implement the page**

```astro
---
// src/pages/graph.astro
// The event map: events that share topics, a series or an organizer, drawn
// close together. Spec: docs/superpowers/specs/2026-09-28-event-graph-design.md.
// Everything below renders at build time; src/scripts/graph.ts only enhances.
import Base from '../layouts/Base.astro';
import { loadEvents } from '../lib/events';
import { formatDateRange } from '../lib/dates';
import { buildEventGraph, clusters, shortLabel } from '../lib/event-graph';
import { graphPayload, layoutGraph } from '../lib/graph-layout';
import { NODE_RADIUS, shapeFor, shapePath } from '../lib/graph-shapes';

const graph = buildEventGraph(loadEvents());
const layout = layoutGraph(graph);
const at = new Map(layout.positions.map((p) => [p.id, p]));
const groups = clusters(graph);
const LEGEND = [
  ['circle', 'Conference'],
  ['square', 'Workshop'],
  ['diamond', 'School'],
  ['triangle', 'Symposium'],
  ['ring', 'Webinar or hackathon'],
] as const;
---

<Base
  title="Event map"
  description="A map of computational chemistry events, linked by shared topics, series and organizers."
  path="/graph/"
>
  <h1>Event map</h1>
  <p class="muted">
    Events that share topics, a series or an organizer are linked; nearby events are similar.
  </p>

  {graph.nodes.length === 0 && <p class="muted">No events to map yet.</p>}
  {
    graph.nodes.length > 0 && (
      <>
        <figure class="graph">
          <svg
            id="event-graph"
            class="graph__svg"
            viewBox={layout.viewBox.join(' ')}
            role="group"
            aria-label="Map of similar events. Each event links to its page."
          >
            <g class="graph__edges" aria-hidden="true">
              {graph.edges.map((e) => {
                const a = at.get(e.source)!;
                const b = at.get(e.target)!;
                return (
                  <line
                    class="graph__edge"
                    data-source={e.source}
                    data-target={e.target}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke-opacity={(0.25 + 0.6 * e.weight).toFixed(2)}
                  />
                );
              })}
            </g>
            <g class="graph__nodes">
              {graph.nodes.map((n) => {
                const p = at.get(n.id)!;
                const shape = shapeFor(n.type);
                const label = shortLabel(n.title);
                return (
                  <a
                    class:list={['graph-node', n.status === 'past' ? 'graph-node--past' : 'graph-node--current']}
                    href={n.href}
                    data-id={n.id}
                  >
                    <title>{n.title}</title>
                    <g class="graph-node__body" transform={`translate(${p.x} ${p.y})`}>
                      {n.status !== 'past' && <circle class="graph-node__halo" r={NODE_RADIUS + 5} />}
                      <path
                        class:list={['graph-node__shape', { 'graph-node__shape--ring': shape === 'ring' }]}
                        d={shapePath(shape)}
                      />
                      <text
                        class="graph-node__label"
                        x={NODE_RADIUS + 7}
                        y="4"
                        data-short={label}
                        data-full={n.title}
                      >
                        {label}
                      </text>
                    </g>
                  </a>
                );
              })}
            </g>
          </svg>
          <figcaption class="graph__legend">
            <ul>
              {LEGEND.map(([shape, name]) => (
                <li>
                  <svg viewBox="-12 -12 24 24" aria-hidden="true">
                    <path
                      class:list={['graph-node__shape', { 'graph-node__shape--ring': shape === 'ring' }]}
                      d={shapePath(shape)}
                    />
                  </svg>
                  {name}
                </li>
              ))}
              <li>
                <svg viewBox="-16 -16 32 32" aria-hidden="true">
                  <circle class="graph-node__halo" r={NODE_RADIUS + 5} />
                  <path class="graph-node__shape" d={shapePath('circle')} />
                </svg>
                Upcoming or ongoing; past events are dimmed
              </li>
            </ul>
          </figcaption>
        </figure>
        <script is:inline type="application/json" id="event-graph-data" set:html={graphPayload(graph, layout)}></script>

        <h2>Clusters</h2>
        <ol class="graph-clusters">
          {groups.map((group) => (
            <li>
              <ul>
                {group.map((n) => (
                  <li class:list={{ muted: n.status === 'past' }}>
                    <a href={n.href}>{n.title}</a>{' '}
                    <span class="mono">{formatDateRange(n.start_date, n.end_date)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </>
    )
  }
</Base>
```

The `<script>` import of `graph.ts` is added in Task 5. Leave the page without it here, so this task's build proves the no-JS page on its own.

- [ ] **Step 5: Append the CSS** (end of `src/styles/global.css`)

```css
/* Event map (/graph/). Spec 2026-09-28. Type is shape, not colour; blue marks
   what you can still attend. Past events dim their shape, never their label —
   see tests/styles/contrast.test.ts. */
.graph {
  margin: var(--space-l) 0;
}

.graph__svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 75vh;
  background: var(--bg-raise);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

.graph.is-live .graph__svg {
  cursor: grab;
  touch-action: none;
}

.graph__edge {
  stroke: var(--rule-strong);
  stroke-width: 1.2;
}

.graph-node__shape {
  fill: var(--fg);
  stroke: var(--bg-raise);
  stroke-width: 1.5;
}

.graph-node__shape--ring {
  fill: none;
  stroke: var(--fg);
  stroke-width: 2.5;
}

.graph-node__halo {
  fill: none;
  stroke: var(--lobe-neg);
  stroke-width: 2;
}

.graph-node__label {
  fill: var(--fg);
  font-family: var(--font-sans);
  font-size: 13px;
}

.graph-node--past .graph-node__shape {
  opacity: 0.35;
}

.graph-node--past .graph-node__label {
  fill: var(--fg-muted);
}

.graph-node {
  cursor: pointer;
}

.graph-node:focus-visible {
  outline: none;
}

.graph-node:focus-visible .graph-node__shape {
  stroke: var(--lobe-neg);
  stroke-width: 3;
}

.graph.is-highlighting .graph-node:not(.is-lit),
.graph.is-highlighting .graph__edge:not(.is-lit) {
  opacity: 0.15;
}

.graph.is-highlighting .graph__edge.is-lit {
  stroke: var(--lobe-neg);
}

.graph__legend ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs) var(--space-m);
  margin: var(--space-s) 0 0;
  padding: 0;
  list-style: none;
  color: var(--fg-muted);
  font-size: var(--step--1);
}

.graph__legend li {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.graph__legend svg {
  width: 1.1em;
  height: 1.1em;
}

.graph-clusters > li + li {
  margin-top: var(--space-s);
}
```

- [ ] **Step 6: Link the page and list it in the sitemap**

In `src/layouts/Base.astro`, footer "About" column, after the Sources `<li>`:

```astro
            <li>
              <a href="/graph/">Event map</a>
            </li>
```

In `src/pages/sitemap.xml.ts:5`:

```ts
export const STATIC_PATHS = ['/', '/archive/', '/about/', '/sources/', '/donate/', '/submit/', '/graph/'];
```

- [ ] **Step 7: Run the tests and the build**

Run: `npx vitest run && npm run build && grep -c 'class="graph-node ' dist/graph/index.html`
Expected: every Vitest test passes, including `tests/endpoints/sitemap.test.ts`, which must accept `/graph/` since `graph.astro` exists; the build succeeds; and the grep count equals the number of non-fixture events (21 today).

Then run `npm run typecheck && npm run lint`. Expected: clean. If Prettier reformats, run `npm run format` and re-check.

- [ ] **Step 8: Commit**

```bash
git add src/lib/graph-shapes.ts tests/lib/graph-shapes.test.ts src/pages/graph.astro src/styles/global.css src/layouts/Base.astro src/pages/sitemap.xml.ts tests/styles/contrast.test.ts
git commit -m "feat(graph): static event map page with shape legend and cluster list"
```

---

### Task 5: Client enhancement (drag, highlight, pan/zoom)

**Files:**
- Create: `src/scripts/graph.ts`
- Modify: `src/pages/graph.astro` (append the module script)
- Test: `tests/e2e/graph.spec.ts`

**Interfaces:**
- Consumes: `createSimulation`, `SimNode`, `GraphPayload` (Task 3); the DOM contract from Task 4.
- Produces: runtime classes `figure.graph.is-live` (enhanced), `.is-highlighting` on the figure, and `.is-lit` on highlighted nodes and edges.

- [ ] **Step 1: Write the failing e2e tests**

```ts
// tests/e2e/graph.spec.ts
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

/** The two ends of the first edge: a node guaranteed to have a neighbour. */
async function linkedPair(page: Page): Promise<[string, string]> {
  const edge = page.locator('.graph__edge').first();
  return [(await edge.getAttribute('data-source'))!, (await edge.getAttribute('data-target'))!];
}

test.describe('event map', () => {
  test('enhances, and hovering a node lights up its neighbour', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/graph/');
    await expect(page.locator('figure.graph')).toHaveClass(/is-live/);
    expect(await page.locator('#event-graph a.graph-node').count()).toBeGreaterThan(1);

    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"] .graph-node__shape`).hover();
    await expect(page.locator('figure.graph')).toHaveClass(/is-highlighting/);
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
    expect(errors).toEqual([]);
  });

  test('keyboard focus highlights too', async ({ page }) => {
    await page.goto('/graph/');
    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"]`).focus();
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
  });

  test('dragging a node moves it and does not navigate', async ({ page }) => {
    await page.goto('/graph/');
    const shape = page.locator('#event-graph a.graph-node .graph-node__shape').first();
    const body = page.locator('#event-graph a.graph-node .graph-node__body').first();
    const before = await body.getAttribute('transform');
    const box = (await shape.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/graph\/$/);
    expect(await body.getAttribute('transform')).not.toBe(before);
  });

  test('clicking a node opens its event page', async ({ page }) => {
    await page.goto('/graph/');
    const node = page.locator('#event-graph a.graph-node').first();
    const href = (await node.getAttribute('href'))!;
    await node.locator('.graph-node__shape').click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test('every node links to a real event page', async ({ page, request }) => {
    await page.goto('/graph/');
    const hrefs = await page
      .locator('#event-graph a.graph-node')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/events\/[^/]+\/$/);
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });

  test('zooming with the wheel changes the viewBox', async ({ page }) => {
    await page.goto('/graph/');
    const svg = page.locator('#event-graph');
    const before = await svg.getAttribute('viewBox');
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(before);
  });

  test('reduced motion: no simulation, highlight still works', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/graph/');
    const body = page.locator('#event-graph .graph-node__body').first();
    const before = await body.getAttribute('transform');
    await page.waitForTimeout(600);
    expect(await body.getAttribute('transform')).toBe(before);
    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"] .graph-node__shape`).hover();
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
  });
});

test.describe('event map without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the static graph and a cluster list covering every event', async ({ page }) => {
    await page.goto('/graph/');
    const nodes = await page.locator('#event-graph a.graph-node').count();
    expect(nodes).toBeGreaterThan(0);
    await expect(page.locator('figure.graph')).not.toHaveClass(/is-live/);
    await expect(page.locator('ol.graph-clusters a')).toHaveCount(nodes);
  });
});
```

- [ ] **Step 2: Run the e2e tests and confirm the JS-dependent ones fail**

Run: `npm run build && npx playwright test tests/e2e/graph.spec.ts`
Expected: FAIL on "enhances…", "keyboard focus…", "dragging…", "zooming…" and "reduced motion…", because nothing adds `is-live` or `is-lit`. The "clicking", "every node links" and "without JavaScript" cases already PASS from Task 4.

- [ ] **Step 3: Implement the client script**

```ts
// src/scripts/graph.ts
// Brings the event map to life: the static SVG from graph.astro becomes a
// live force simulation you can drag, with hover/focus highlighting of an
// event's neighbours and pan/zoom on the viewBox. Everything here is an
// enhancement — without it the page is a working map of links.
import type { GraphPayload, SimNode } from '../lib/graph-layout';
import { createSimulation } from '../lib/graph-layout';

const figure = document.querySelector<HTMLElement>('figure.graph');
const svg = document.querySelector<SVGSVGElement>('#event-graph');
const payload = readPayload();

if (figure && svg && payload) enhance(figure, svg, payload);

function readPayload(): GraphPayload | null {
  try {
    const data = JSON.parse(document.querySelector('#event-graph-data')?.textContent ?? '');
    return Array.isArray(data?.nodes) && Array.isArray(data?.edges) ? data : null;
  } catch {
    return null;
  }
}

/** Pointer travel, in CSS pixels, below which a press is a click, not a drag. */
const DRAG_SLOP = 4;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

function enhance(figure: HTMLElement, svg: SVGSVGElement, payload: GraphPayload) {
  // Pointer state, declared first: the highlight handlers below read `dragging`.
  let dragging: SimNode | null = null;
  let moved = false;
  let suppressClick = false;

  const nodeEls = new Map<string, SVGAElement>();
  for (const a of svg.querySelectorAll<SVGAElement>('a.graph-node')) nodeEls.set(a.dataset.id!, a);
  const edgeEls = [...svg.querySelectorAll<SVGLineElement>('.graph__edge')];

  const neighbours = new Map<string, Set<string>>();
  for (const { source, target } of payload.edges) {
    if (!neighbours.has(source)) neighbours.set(source, new Set());
    if (!neighbours.has(target)) neighbours.set(target, new Set());
    neighbours.get(source)!.add(target);
    neighbours.get(target)!.add(source);
  }

  // --- Highlight -----------------------------------------------------------
  let lit: string | null = null;
  function highlight(id: string | null) {
    if (id === lit) return;
    if (lit) setLabel(lit, 'short');
    lit = id;
    figure.classList.toggle('is-highlighting', id !== null);
    const near = id ? neighbours.get(id) ?? new Set<string>() : new Set<string>();
    for (const [nid, el] of nodeEls) el.classList.toggle('is-lit', nid === id || near.has(nid));
    for (const el of edgeEls) {
      el.classList.toggle('is-lit', id !== null && (el.dataset.source === id || el.dataset.target === id));
    }
    if (id) setLabel(id, 'full');
  }
  function setLabel(id: string, which: 'short' | 'full') {
    const text = nodeEls.get(id)?.querySelector<SVGTextElement>('.graph-node__label');
    if (text) text.textContent = text.dataset[which] ?? text.textContent;
  }
  const nodeOf = (t: EventTarget | null) =>
    t instanceof Element ? t.closest<SVGAElement>('a.graph-node') : null;

  svg.addEventListener('pointerover', (e) => {
    if (!dragging) highlight(nodeOf(e.target)?.dataset.id ?? null);
  });
  svg.addEventListener('pointerleave', () => {
    if (!dragging) highlight(null);
  });
  svg.addEventListener('focusin', (e) => highlight(nodeOf(e.target)?.dataset.id ?? null));
  svg.addEventListener('focusout', () => highlight(null));

  // --- viewBox pan / zoom ----------------------------------------------------
  const base = svg.getAttribute('viewBox')!.split(/\s+/).map(Number) as [number, number, number, number];
  const vb = [...base] as [number, number, number, number];
  const applyViewBox = () => svg.setAttribute('viewBox', vb.join(' '));
  function toSvg(clientX: number, clientY: number) {
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  function zoomAt(clientX: number, clientY: number, factor: number) {
    const scale = Math.min(Math.max((vb[2] * factor) / base[2], ZOOM_MIN), ZOOM_MAX);
    const next = scale * base[2];
    const k = next / vb[2];
    const p = toSvg(clientX, clientY);
    vb[0] = p.x - (p.x - vb[0]) * k;
    vb[1] = p.y - (p.y - vb[1]) * k;
    vb[2] = next;
    vb[3] = vb[3] * k;
    applyViewBox();
  }
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.001));
    },
    { passive: false },
  );

  // --- Simulation ------------------------------------------------------------
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const simNodes: SimNode[] = payload.nodes.map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const simById = new Map(simNodes.map((n) => [n.id, n]));
  const sim = createSimulation(simNodes, payload.edges);
  sim.on('tick', render);

  function render() {
    for (const n of simNodes) {
      nodeEls
        .get(n.id)
        ?.querySelector('.graph-node__body')
        ?.setAttribute('transform', `translate(${n.x!.toFixed(1)} ${n.y!.toFixed(1)})`);
    }
    for (const el of edgeEls) {
      const a = simById.get(el.dataset.source!);
      const b = simById.get(el.dataset.target!);
      if (!a || !b) continue;
      el.setAttribute('x1', a.x!.toFixed(1));
      el.setAttribute('y1', a.y!.toFixed(1));
      el.setAttribute('x2', b.x!.toFixed(1));
      el.setAttribute('y2', b.y!.toFixed(1));
    }
  }

  // --- Pointer: drag a node, pan the background, pinch to zoom ---------------
  const pointers = new Map<number, { x: number; y: number }>();
  let start = { x: 0, y: 0 };
  let pinchDistance = 0;

  svg.addEventListener('pointerdown', (e) => {
    const nodeEl = nodeOf(e.target);
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    if (nodeEl && !still) {
      e.preventDefault(); // no native link drag or text selection
      dragging = simById.get(nodeEl.dataset.id!) ?? null;
      if (dragging) {
        dragging.fx = dragging.x;
        dragging.fy = dragging.y;
        sim.alphaTarget(0.3).restart();
      }
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (nodeEl) return; // reduced motion: nodes stay put, clicks navigate
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinchDistance = Math.hypot(p!.x - q!.x, p!.y - q!.y);
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP) moved = true;
    if (dragging) {
      const p = toSvg(e.clientX, e.clientY);
      dragging.fx = p.x;
      dragging.fy = p.y;
      return;
    }
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const distance = Math.hypot(p!.x - q!.x, p!.y - q!.y);
      if (pinchDistance > 0) zoomAt((p!.x + q!.x) / 2, (p!.y + q!.y) / 2, pinchDistance / distance);
      pinchDistance = distance;
    } else if (pointers.size === 1) {
      const unit = vb[2] / svg.clientWidth;
      vb[0] -= (e.clientX - prev.x) * unit;
      vb[1] -= (e.clientY - prev.y) * unit;
      applyViewBox();
    }
  });

  function release(e: PointerEvent) {
    if (dragging) {
      dragging.fx = null;
      dragging.fy = null;
      sim.alphaTarget(0);
      suppressClick = moved;
      dragging = null;
      highlight(nodeOf(document.elementFromPoint(e.clientX, e.clientY))?.dataset.id ?? null);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
  }
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  // A drag that ends over its own node must not follow the link.
  svg.addEventListener(
    'click',
    (e) => {
      if (suppressClick && nodeOf(e.target)) e.preventDefault();
      suppressClick = false;
    },
    true,
  );

  figure.classList.add('is-live');
  if (!still) sim.alpha(0.08).restart();
}
```

Append to the end of `src/pages/graph.astro` (outside `<Base>`, the same pattern as `index.astro:144`):

```astro
<script>
  import '../scripts/graph.ts';
</script>
```

- [ ] **Step 4: Run the e2e tests and confirm they pass**

Run: `npm run build && npx playwright test tests/e2e/graph.spec.ts`
Expected: PASS, all 8 tests. If "dragging…" is flaky because the first node sits under another node's label, pick the node via `linkedPair`'s source instead of `.first()`. Don't add waits.

- [ ] **Step 5: Run the full suite**

Run: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build && npm run test:e2e`
Expected: everything passes.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/graph.ts src/pages/graph.astro tests/e2e/graph.spec.ts
git commit -m "feat(graph): draggable force simulation, neighbour highlight, pan and zoom"
```

---

### Task 6: Visual check, tuning, spec sync

**Files:**
- Possibly modify: `src/lib/event-graph.ts` (weight/threshold constants), `src/lib/graph-layout.ts` (force constants)
- Modify: `docs/superpowers/specs/2026-09-28-event-graph-design.md` (record the two deviations)

- [ ] **Step 1: Open the real page in a browser**

Run `npm run build && npm run preview -- --port 4321`, then open `http://127.0.0.1:4321/graph/` with Playwright MCP (`browser_navigate`, `browser_take_screenshot`). Check each of these and screenshot it:
1. The dark theme at 1280 px: clusters are visibly separate, with CECAM events and CCP5 events each grouped, and labels don't pile on top of each other.
2. The light theme: click the masthead toggle.
3. 360 px width: the graph fits with no horizontal page scroll, and the cluster list is readable.
4. Drag a node: its neighbours follow and it springs back into place. Hover a node: its neighbours light up.

- [ ] **Step 2: Tune only if the screenshots show a problem**

- If everything collapses into one blob, raise `EDGE_THRESHOLD` in steps of 0.05.
- If it's a scatter of singletons, lower it in steps of 0.05.
- If labels collide, raise `forceCollide` radius or `forceManyBody` strength in `createSimulation`.
- After any change, re-run `npx vitest run tests/lib` and the Step 1 screenshots. Keep the spec's weights unless the screenshots argue otherwise; if they change, update the Global Constraints values in the spec.

- [ ] **Step 3: Sync the spec**

In `docs/superpowers/specs/2026-09-28-event-graph-design.md`:
- In the `organizerKeys` bullet, change "(runs of letters/digits containing at least two capitals, …)" to "(tokens of at least three characters containing at least two capitals, …); the length floor keeps country codes in node names (IT, NL, DE) from linking unrelated events".
- In Testing, replace the `tests/pages/links.test.ts` bullet with: "`tests/e2e/graph.spec.ts`: every node's href returns 200 from the production preview (`links.test.ts` is a source-grep test and cannot check built pages)."
- Record any tuned constants.

- [ ] **Step 4: Final verification and commit**

Run: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build && npm run test:e2e`
Expected: all green.

```bash
git add -A docs/superpowers/specs/2026-09-28-event-graph-design.md src/lib
git commit -m "docs(graph): sync spec with implementation; tune layout after visual check"
```
