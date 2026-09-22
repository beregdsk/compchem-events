# Design: site redesign — navigation, palette and compchem motifs

Date: 2026-09-21 · Status: **approved in brainstorm, pending maintainer review** ·
Refines `docs/superpowers/specs/2026-09-20-compchem-events-site-design.md` section 8

## 1. Goal

Make the upcoming-events list the whole front of the site. Remove the chrome that competes
with it: the top navigation bar and the separate deadlines page. Recolour the site around
the red and blue phase lobes of a molecular orbital isosurface, and let the page's texture
hint at computational chemistry without adding a single network request.

Success: a visitor lands on `/` and sees events immediately, with no menu bar to parse. The
actions they might want — add an event, browse the archive, subscribe to the calendar — sit
beside the result count as page controls. Everything else lives in the footer. The palette
reads as a rendered isosurface on a dark ground, and every foreground colour meets WCAG AA.

Non-goals: per-event images or logos (raised and deferred in the brainstorm); any change to
the event schema, the loader, the feeds, or the filtering logic beyond the one deletion in
D5; light mode; web fonts.

## 2. Decisions made in this brainstorm

| # | Decision | Reason |
|---|---|---|
| D1 | **Deadlines: the page only.** `/deadlines/` is deleted. `/deadlines.ics`, the deadline pill on each event row, the deadline table on each event page, the countdown island and the "has an open deadline" filter all stay. | The maintainer wants one front page, not less deadline information. Deadlines remain visible everywhere they are attached to an event; only the standalone index of them goes. |
| D2 | **`/policy/` is merged into `/about/`.** The curation policy renders inside the about page under `<h2 id="curation-policy">`; `/policy/` stops existing and its inbound links become `/about/#curation-policy`. | "Move about to the footer" leaves the footer with two long-form pages to point at. One page holding what the site is, how it works, privacy, feeds and the curation policy is a smaller surface with the same content. |
| D3 | **No top menu bar.** The masthead keeps only the wordmark and tagline. Routes move to a three-column footer, plus a small inline action row beside the result count. | The action row reads as page controls rather than site navigation, which is what the events-first framing asks for. |
| D4 | **Dark only.** The `prefers-color-scheme: light` block is deleted and `color-scheme` becomes `dark`. | Maintainer decision. The isosurface metaphor is a render on a dark ground; maintaining a second theme that contradicts it costs more than it returns. This narrows the 2026-09-20 spec section 8, which specified dark-first with a warm-paper light mode. **Superseded later the same day:** the light theme is back, selectable from a masthead toggle and defaulting to the system preference. See `docs/decisions.md`. |
| D5 | **The `data-noun-*` branch in `src/scripts/filters.ts` is removed.** | It exists only so `/deadlines/` could say "open deadlines" instead of "upcoming events". With that page gone, no caller sets those attributes, and lean-build forbids configuration for a fixed value. Its regression test at `tests/scripts/filters.test.ts:183` goes with it. |
| D6 | **System font stack retained**, reaffirming D2 of the 2026-09-20 spec. Self-hosted woff2 faces were offered and declined. | Zero font bytes and no licence obligations. Character comes from colour, scale, the mono metadata layer and the background substrate instead. |
| D7 | **Per-event images deferred, not rejected.** | They need a schema field, committed binary assets, and a position on third-party logo use under `AGENTS.md` rule 2. None of that is settled, and the redesign does not depend on it. Revisit as its own task. |

## 3. Routes after the change

| Route | Status |
|---|---|
| `/` | Unchanged purpose; new masthead, action row and palette. The site's only index. |
| `/events/<id>/` | Unchanged, repainted. Deadline table stays. |
| `/archive/` | Unchanged, repainted. Gains a back-to-upcoming action. |
| `/about/` | Absorbs the curation policy as a section. |
| `/submit/` | Unchanged, repainted. |
| `/deadlines/` | **Deleted.** |
| `/policy/` | **Deleted**, content merged into `/about/`. |
| `/events.ics`, `/deadlines.ics`, `/feed.xml`, `/events.json`, `/sitemap.xml`, `/robots.txt` | All unchanged. |
| `/404` | Link list updated to the surviving routes. |

`src/pages/sitemap.xml.ts` `STATIC_PATHS` becomes `['/', '/archive/', '/about/', '/submit/']`.

## 4. Layout

### Masthead (`src/layouts/Base.astro`)

The `nav` array, the `.site-nav` markup and the `aria-current` logic are deleted. The `path`
prop stays: it still builds the canonical URL and the title. What remains is the site name
as a link to `/`, the tagline beneath it, and the contour substrate described in section 6.
The skip link keeps pointing at `#main`.

### Action row (`src/components/PageActions.astro`, new)

A small mono row rendered beside the result count, not in the masthead. It takes a list of
`{ href, label }` and renders a plain `<ul>` of links — deliberately not a `<nav>` element,
so the page does not gain a second navigation landmark for a set of page controls.

- On `/`: Add an event · Archive · Subscribe (.ics)
- On `/archive/`: Upcoming events · Add an event

### Footer (`src/layouts/Base.astro`)

Three columns, each a headed list:

| Column | Contents |
|---|---|
| About | Two sentences on what the site is, then a link to `/about/`. |
| Contribute | Add an event · Curation policy (`/about/#curation-policy`) · Source repository. |
| Feeds | Events calendar · Deadlines calendar · Atom feed · JSON export. |

The footer is the only place `/about/` is linked from the chrome, which is what "move about
to the footer" asks for.

### Link rewrites

The policy file's headings are demoted one level in the file itself, so they nest under the
about page's `<h1>` and the `## Curation policy` heading's generated id serves the anchor.
Astro 7 exposes heading transforms only through the Sätteri processor's `hastPlugins`, which
would mean importing a package the project does not depend on directly; a one-time text edit
costs nothing and leaves `astro.config.ts` untouched.

`/policy/` currently appears in `src/pages/index.astro`, `src/pages/submit.astro`,
`src/pages/about.astro` and the `Base.astro` footer. All become `/about/#curation-policy`.
The first line of `docs/curation-policy.md`, which states the file is published at
`/policy/`, is corrected to `/about/#curation-policy`.

## 5. Palette

All values are tokens on `:root` in `src/styles/global.css`. The existing `--warm` and
`--cool` tokens appear in that file only, so the rename touches one file.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#06080c` | Page ground. Deeper than the current `#0a0e13` so both lobes read as emission. |
| `--bg-raise` | `#0e141c` | Inputs, pills, the skip link. |
| `--fg` | `#dfe6ee` | Body text. |
| `--fg-muted` | `#8b9aab` | Metadata, legends, footer text. |
| `--rule` | `#182231` | Decorative separators between event rows. |
| `--rule-strong` | `#2a3a4d` | Emphasised separators, table head borders. |
| `--control` | `#5b6d80` | Borders of interactive controls: inputs, selects, the clear-filters button. New token; the old `--rule-strong` was too dim for a control boundary. |
| `--lobe-neg` | `#7ab6ff` | The blue phase lobe. |
| `--lobe-neg-soft` | `#0d1f36` | Blue fills: topic pill backgrounds. |
| `--lobe-pos` | `#ff7a68` | The red phase lobe. |
| `--lobe-pos-soft` | `#2e100c` | Red fills: deadline pill backgrounds. |
| `--link` | alias of `--lobe-neg` | Links, topic pills, the event title hover state. |
| `--time` | alias of `--lobe-pos` | Dates, deadline pills, status pills, `.warn`, the focus ring. |

The focus ring stays red while links are blue, so a focused control never reads as a link.

Measured contrast ratios (sRGB, WCAG 2.1 formula):

| Pair | Ratio | Requirement |
|---|---|---|
| `--fg` on `--bg` | 15.93 | 4.5 |
| `--fg-muted` on `--bg` | 6.97 | 4.5 |
| `--fg-muted` on `--bg-raise` | 6.44 | 4.5 |
| `--link` on `--bg` | 9.51 | 4.5 |
| `--time` on `--bg` | 7.86 | 4.5 |
| `--control` on `--bg-raise` | 3.47 | 3.0 (WCAG 1.4.11) |

`--rule` and `--rule-strong` sit below 3:1 deliberately: they separate rows that are already
separated by whitespace and heading hierarchy, and carry no information on their own.

The implementation recomputes these ratios and reports them; any value that misses its
requirement is fixed before the change lands, not waived.

## 6. Motifs

Both motifs are pure CSS. No images, no requests, no runtime cost.

**Isosurface field.** `body` keeps a fixed, non-repeating background of radial gradients,
with the current teal and amber lobes replaced by `--lobe-neg` top-left and `--lobe-pos`
top-right, each mixed to a low alpha with `color-mix`. A third, dimmer lobe low on the page
gives the ground depth rather than a flat vignette.

**Superseded:** the gradient field was replaced with a Monte-Carlo point cloud sampled from
|ψ|² of a 3d(z²) orbital, generated at build time and emitted as inline SVG
(`src/lib/orbital.ts`, `src/components/OrbitalField.astro`). It is a plate in the masthead,
not a wash behind the page — measured in a browser, a full-page cloud is either illegible
or in the way of the event list. `body` keeps one soft wash. This motif is therefore no
longer pure CSS, and no longer free: it adds about 11 kB gzipped per page, still with no
requests. The masthead grew to `clamp(11rem, 22vw, 20rem)` to hold it.

**Contour substrate.** The masthead carries two layers: a 1px lattice
(`repeating-linear-gradient` on both axes, at a spacing that reads as a plotting grid) and a
set of faint contour rings (`repeating-radial-gradient`). Both are faded with `mask-image`
so they vanish before they reach the wordmark. The substrate is scoped to the masthead; the
event list stays quiet, because texture behind a dense list costs legibility.

**Mono metadata layer.** With no display face to carry character, the existing mono stack
does more work: tabular figures on every date, uppercase tracked legends, and the result
count and action row set as one instrument-panel line.

The existing `prefers-reduced-motion: no-preference` guard and the staggered `.reveal`
animation are kept unchanged.

## 7. Files touched

| File | Change |
|---|---|
| `src/pages/deadlines.astro` | Deleted. |
| `src/pages/policy.astro` | Deleted. |
| `src/pages/about.astro` | Renders `docs/curation-policy.md` under `<h2 id="curation-policy">`; `/policy/` link rewritten. |
| `src/layouts/Base.astro` | Nav removed; masthead rebuilt; footer becomes three columns. |
| `src/components/PageActions.astro` | New. |
| `src/pages/index.astro` | Action row added; `/policy/` link rewritten. |
| `src/pages/archive.astro` | Action row added. |
| `src/pages/submit.astro` | `/policy/` link rewritten. |
| `src/pages/404.astro` | Link list updated. |
| `src/pages/sitemap.xml.ts` | `STATIC_PATHS` updated. |
| `src/scripts/filters.ts` | `data-noun-*` branch removed (D5). |
| `src/styles/global.css` | Light block deleted; tokens renamed and revalued; masthead substrate; footer columns; action row; `.site-nav` rules removed. |
| `tests/scripts/filters.test.ts` | The `data-noun-*` regression test removed (D5). |
| `docs/curation-policy.md` | Publication path corrected. |
| `docs/decisions.md` | Entries for D1, D2, D4, D5. |
| `README.md` | No change needed: it links the policy *file*, not the route, and never mentions the deadlines page. Verified in Task 6. |

Nothing under `data/`, `schema/`, `src/lib/` or the feed endpoints changes.

## 8. Verification

1. `npm run lint`, `npm run typecheck`, `npm run validate`, `npm test`, `npm run build` all pass.
2. Against `dist/`: no `href="/deadlines/"` or `href="/policy/"` remains anywhere; `dist/deadlines.ics` is still emitted and still contains VEVENTs; `dist/sitemap.xml` lists exactly the four static routes plus the event pages.
3. Contrast ratios from section 5 recomputed against the shipped token values and reported as numbers.
4. `/` renders every upcoming event with JavaScript disabled, and the filter island still filters with it enabled — the existing `tests/scripts/filters.test.ts` suite covers the island minus the removed branch.
5. Keyboard pass on `/`: skip link, action row, filters, event links all reachable with a visible red focus ring.
