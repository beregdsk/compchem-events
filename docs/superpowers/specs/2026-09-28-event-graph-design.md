# Event map (similarity graph) — design

Date: 2026-09-28. Status: approved and implemented (plan `docs/superpowers/plans/2026-09-28-event-graph.md`).

## Intent

A visitor-facing discovery tool: an Obsidian-style graph at `/graph/` where
similar events cluster together, so someone who finds one event they like can
see its neighbours and follow them to their event pages.

Agreed with the maintainer:

- **Audience:** visitors discovering events (not a maintainer coverage view,
  not a showpiece).
- **Scope:** all non-fixture events — upcoming and ongoing at full strength,
  past events dimmed. Past editions show what a community runs regularly.
- **Similarity:** shared topics, same series, same organizer.
- **Rendering:** d3-force both at build time (static, seeded SVG — the no-JS
  fallback and first paint) and in the browser (drag, highlight, pan/zoom).

Non-goals: explicit clustering algorithms, filtering controls on the graph,
new schema fields, a maintainer coverage report.

## Constraints from the repo

- `AGENTS.md`: client JS minimal and progressive — the page must be readable
  without it. New dependencies must be small, justified in the PR, and make no
  runtime network calls.
- `TASK.md`: the 30 kB gzipped JS budget applies to the home page; the graph
  page is a separate route and does not affect it. No third-party scripts —
  d3-force is bundled by Astro, never loaded from a CDN.
- Accessibility (keyboard, WCAG AA contrast, `prefers-reduced-motion`) and
  responsiveness to 360 px are requirements.

## Architecture

```
data/events/*.yaml → loadEvents() → buildEventGraph() → layoutGraph()
                                       → graph.astro: static SVG + JSON blob
                                       → src/scripts/graph.ts: live simulation
```

### `src/lib/event-graph.ts` (pure, no DOM, no d3)

- `organizerKeys(organizer?: string): Set<string>` — split on `;`; from each
  part take acronym tokens (tokens of at least three characters containing at
  least two capitals, e.g. CECAM, CCP5, RSC, MolSSI, GDCh), lowercased. The
  length floor keeps country codes in node names (IT, NL, DE) from linking
  unrelated events. A part with no
  acronym contributes its whole trimmed text, lowercased. Missing organizer →
  empty set.
- `similarity(a, b): number` =
  `0.6 · jaccard(a.topics, b.topics) + 0.25 · [a.series && a.series === b.series] + 0.15 · [organizerKeys intersect]`,
  capped at 1. Symmetric.
- `buildEventGraph(events: LoadedEvent[]): EventGraph`
  - `nodes`: `{ id, title, type, status: DerivedStatus, href: '/events/<id>/' }`
  - `edges`: `{ source, target, weight }`, undirected, no self-loops, no
    duplicates. Kept when `weight ≥ 0.35`; additionally every node keeps its
    single highest-weight edge (if weight > 0) even below the threshold, so
    nothing floats alone unless it shares nothing with anything.
- Weights and threshold are named constants, tuned once against the real
  rendered data.

### `src/lib/graph-layout.ts` (build time)

Thin wrapper over d3-force: link (strength ∝ weight, distance 35),
short-range many-body charge (−90, max distance 250), weak x/y centering
(0.04/0.06) and collide (radius 16). Labels are hidden until hover, so the
layout only makes room for shapes and similar events can sit close together
(retuned 2026-09-29 against the real data); `randomSource` seeded from a fixed constant; a
fixed number of ticks run synchronously. Returns `{ id, x, y }` per node,
fitted into a fixed square viewBox. Same input → identical output, so rebuilds
don't churn.

### `src/pages/graph.astro`

- Loads events (fixtures excluded as in production), builds and lays out the
  graph, renders inline SVG.
- Each node is an `<a href="/events/<id>/">` containing its shape, a `<title>`
  with the full event title, and a label truncated to ~28 characters. The label
  is shown only for the hovered or focused node (full title when the script
  runs, printed to the left for nodes in the right half of the view).
- Edge stroke opacity scales with weight.
- Node positions and edges are embedded as `<script type="application/json">`
  for the client.
- Below the graph: a plain list grouped by cluster (connected component) with
  links to each event — the accessible / no-JS / small-screen fallback.
- Empty state: zero events → no SVG, one explanatory line.
- Linked from the site footer alongside Archive / Sources.

### `src/scripts/graph.ts` (client enhancement)

- Imports d3-force (bundled). Reads the JSON blob; if missing or malformed,
  does nothing and the static SVG stays.
- Starts the simulation from the build positions at low alpha (gentle settle).
- Drag a node: neighbours follow via link forces; on release the node rejoins
  the simulation. A drag does not trigger the link navigation.
- Hover or keyboard focus a node: that node, its edges and its neighbours
  highlighted; everything else faded to ~15%.
- Pan (background drag) and zoom (wheel / pinch) by rewriting the SVG
  `viewBox` — no d3-zoom.
- `prefers-reduced-motion: reduce`: no simulation; static layout plus
  highlight only.

## Visual encoding

The site's palette is two accents with fixed meanings (blue = interactive,
red = time/attention), so event type is encoded by **shape**, not colour:

| Type                | Shape    |
| ------------------- | -------- |
| conference          | circle   |
| workshop            | square   |
| school              | diamond  |
| symposium           | triangle |
| webinar / hackathon | ring     |

- Shapes drawn in `--fg`. Upcoming and ongoing nodes get a `--lobe-neg` halo.
- Past nodes at ~35% opacity.
- A legend below the graph explains shape and dimming.
- Page heading "Event map", one explanatory line: "Events that share topics, a
  series or an organizer are linked; nearby events are similar."

## Dependency

`d3-force` v3 (ISC; pulls d3-dispatch, d3-quadtree, d3-timer; ~15 kB
gzipped). Justification for the PR: it is the standard, small, maintained
force-simulation implementation; used both at build and in the browser, so one
dependency covers layout and interaction; no runtime network calls.

## Testing

- `tests/lib/event-graph.test.ts`
  - `organizerKeys`: `CECAM-IT-SISSA`, `CECAM Beijing node`, `CECAM` → `cecam`;
    `CCP5; RSC Statistical…` → `{ccp5, rsc}`;
    `Molecular Sciences Software Institute (MolSSI)` → `molssi`;
    `Telluride Science` → whole-text fallback; undefined → empty.
  - `similarity`: identical topics only → 0.6; series match only → 0.25;
    symmetric; capped at 1.
  - `buildEventGraph`: threshold edges present; best-edge guarantee; no
    self-loops; no duplicate undirected edges.
- `tests/lib/graph-layout.test.ts`: deterministic for the same input; all
  positions finite and inside the viewBox.
- `tests/e2e/graph.spec.ts`: every node's href returns 200 from the
  production preview (`tests/pages/links.test.ts` is a source-grep test and
  cannot check built pages).
- `tests/e2e/smoke.spec.ts`: `/graph/` renders one node per event with no
  console errors; hovering a node applies the highlight to its neighbours;
  with JS disabled the SVG and cluster list are present.
- `tests/styles/contrast.test.ts`: dimmed past-node label colour against
  `--bg` in both themes meets AA.
- Manual: inspect the page in a browser — clusters actually form, both
  themes, 360 px, drag feel — and tune the weights there.

Definition of done: lint, typecheck, validate, tests and build pass.
