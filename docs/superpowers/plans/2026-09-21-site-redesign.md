# Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the upcoming-events list the whole front of the site — no top menu bar, no separate deadlines page — and recolour it around red and blue orbital phase lobes on a dark-only ground.

**Architecture:** Six tasks, each independently testable. Two route deletions come first, each guarded by a new test that fails when a page disappears while something still points at it. Then the chrome is rebuilt (masthead, footer, inline action row), then the palette is replaced token-by-token with a contrast test that keeps the AA claim honest, then the CSS motifs, then a whole-site verification sweep.

**Tech Stack:** Astro 7 static output, TypeScript strict, vanilla client-side TypeScript, vitest + happy-dom, plain CSS with custom properties. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-21-site-redesign-design.md`

## Global Constraints

- `AGENTS.md` rule 3: static only. No server code, no runtime database, no serverless functions.
- `AGENTS.md` rule 4: no analytics, cookies, third-party scripts, external fonts or CDNs. Everything self-hosted in the build output. This redesign adds **no** image files, **no** font files and **no** network requests.
- Spec D6: the system font stack stays. Do not add `@font-face`.
- Spec D4: dark only. `src/styles/global.css` must contain no `prefers-color-scheme: light` block when this plan is done.
- `AGENTS.md` code style: TypeScript strict, no `any` without a comment explaining why; accessibility is a requirement, not polish; client-side JavaScript stays minimal and progressive — every page must be readable and complete without it.
- Run `npm run lint`, `npm run typecheck`, `npm run validate`, `npm test` and `npm run build` before every commit.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Work on branch `feat/redesign`. Never commit to `main`.
- Nothing under `data/`, `schema/`, `src/lib/` or the feed endpoints (`events.ics`, `deadlines.ics`, `feed.xml`, `events.json`) changes in this plan.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/layouts/Base.astro` | Document head, skip link, masthead (wordmark + tagline only), three-column footer. No navigation array. |
| `src/components/PageActions.astro` | **New.** Renders a page's inline action links as a plain `<ul>`. Used by `/` and `/archive/`. |
| `src/pages/sitemap.xml.ts` | Exports `STATIC_PATHS` (now also imported by its test) and the `GET` route. |
| `src/pages/about.astro` | The site's only long-form page: what it is, how it works, privacy, feeds, the curation policy, corrections, source. |
| `src/scripts/filters.ts` | The filter island. Says "event"/"events" directly; no per-page noun configuration. |
| `src/styles/global.css` | Dark-only tokens, isosurface background, masthead substrate, footer columns, action row. |
| `astro.config.ts` | Adds one inline rehype plugin that demotes `docs/curation-policy.md` headings by one level so they nest under the about page's `<h1>`. |
| `tests/endpoints/sitemap.test.ts` | **New.** The sitemap advertises only routes that still have a page file. |
| `tests/pages/links.test.ts` | **New.** No source file links to a deleted route. |
| `tests/styles/contrast.test.ts` | **New.** Every foreground token meets its WCAG ratio against its ground. |
| Deleted | `src/pages/deadlines.astro`, `src/pages/policy.astro` |

---

## Task 1: Delete the deadlines page, guarded by two new tests

**Files:**
- Create: `tests/endpoints/sitemap.test.ts`
- Create: `tests/pages/links.test.ts`
- Modify: `src/pages/sitemap.xml.ts:5`
- Modify: `src/pages/404.astro:8-11`
- Modify: `src/scripts/filters.ts:59-68` and `:78-80`
- Modify: `tests/scripts/filters.test.ts` (delete `setDeadlinesFixture` and the test that uses it)
- Modify: `docs/decisions.md` (append)
- Delete: `src/pages/deadlines.astro`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export const STATIC_PATHS: string[]` from `src/pages/sitemap.xml.ts`, imported by `tests/endpoints/sitemap.test.ts` in this task and relied on by Task 2.

- [ ] **Step 1: Export the sitemap's path list so a test can see it**

In `src/pages/sitemap.xml.ts`, change line 5 from `const STATIC_PATHS = ...` to:

```ts
export const STATIC_PATHS = ['/', '/deadlines/', '/archive/', '/about/', '/submit/', '/policy/'];
```

The values stay wrong on purpose — the test written next is what removes them.

- [ ] **Step 2: Write the route-guard test**

Create `tests/endpoints/sitemap.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_PATHS } from '../../src/pages/sitemap.xml';

/** `/` is served by `index.astro`; `/archive/` by `archive.astro`. Event pages
 * are appended by the route itself from the loader, so only the static list
 * needs a file on disk. */
function pageFile(path: string): string {
  const slug = path.replace(/^\/+|\/+$/g, '');
  return slug === '' ? 'src/pages/index.astro' : `src/pages/${slug}.astro`;
}

describe('sitemap static paths', () => {
  it('advertises only routes that still have a page file', () => {
    expect(STATIC_PATHS.filter((p) => !existsSync(pageFile(p)))).toEqual([]);
  });

  it('starts at the home page', () => {
    expect(STATIC_PATHS[0]).toBe('/');
  });
});
```

- [ ] **Step 3: Write the dead-link guard test**

Create `tests/pages/links.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every `.astro` file under `src/`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.astro') ? [path] : [];
  });
}

/** Routes this redesign removed. A link to one of them would 404. */
const REMOVED = /href="\/deadlines\/"/;

describe('internal links', () => {
  it('never points at a removed route', () => {
    const offenders = sources('src').filter((f) => REMOVED.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 4: Run both tests — the link guard must fail now**

Run: `npx vitest run tests/endpoints/sitemap.test.ts tests/pages/links.test.ts`

Expected: `sitemap.test.ts` PASSES (all six pages still exist). `links.test.ts` FAILS, listing `src/pages/404.astro` — it links to `/deadlines/`.

- [ ] **Step 5: Delete the deadlines page and fix the 404 copy**

```bash
git rm src/pages/deadlines.astro
```

In `src/pages/404.astro`, replace the paragraph:

```astro
    <p>
      That page does not exist. Try the <a href="/">list of upcoming events</a>, the
      <a href="/archive/">archive</a>, or <a href="/submit/">add an event</a>.
    </p>
```

- [ ] **Step 6: Run the tests again — now the sitemap guard must fail**

Run: `npx vitest run tests/endpoints/sitemap.test.ts tests/pages/links.test.ts`

Expected: `links.test.ts` PASSES. `sitemap.test.ts` FAILS with `["/deadlines/"]` — the sitemap still advertises the page that was just deleted.

- [ ] **Step 7: Drop the deadlines path from the sitemap**

In `src/pages/sitemap.xml.ts`:

```ts
export const STATIC_PATHS = ['/', '/archive/', '/about/', '/submit/', '/policy/'];
```

- [ ] **Step 8: Run the tests — both pass**

Run: `npx vitest run tests/endpoints/sitemap.test.ts tests/pages/links.test.ts`
Expected: PASS.

- [ ] **Step 9: Remove the per-page noun configuration from the filter island (spec D5)**

In `src/scripts/filters.ts`, delete the comment block and the three constants at lines 59-68:

```ts
  // The noun ("event" vs "deadline") and the empty-filter adjective ("upcoming"
  // vs "open") vary by page. ...
  const nounSingular = countEl!.dataset.nounSingular ?? 'event';
  const nounPlural = countEl!.dataset.nounPlural ?? 'events';
  const emptyAdjective = countEl!.dataset.emptyAdjective ?? 'upcoming';
```

and replace their only use inside `apply()` with the literal wording:

```ts
    countEl!.textContent = isEmptyFilter(state)
      ? `${shown} upcoming ${shown === 1 ? 'event' : 'events'}`
      : `${shown} of ${rows.length} ${rows.length === 1 ? 'event' : 'events'} match`;
```

- [ ] **Step 10: Delete the test that covered the removed branch**

In `tests/scripts/filters.test.ts`, delete the whole `setDeadlinesFixture` helper (its doc comment included) and the test titled `on load, a page whose #result-count carries deadline data attributes reports "open deadlines", not "upcoming events"`. Leave every other test untouched.

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS, with the deleted test gone from the report and no other test failing.

- [ ] **Step 12: Record the decisions**

Append to `docs/decisions.md`:

```markdown
## 2026-09-21 — The `/deadlines/` page is removed; deadline data stays everywhere else

The redesign makes the upcoming-events list the whole front of the site, so the
standalone index of deadlines goes. Every other surface that carries deadline
information stays: `/deadlines.ics`, the deadline pill on each event row, the
deadline table on each event page, the countdown island and the "has an open
deadline" filter. No event data and no schema field changed.

## 2026-09-21 — The filter island says "event" directly

`src/scripts/filters.ts` read `data-noun-singular`, `data-noun-plural` and
`data-empty-adjective` off `#result-count` so the `/deadlines/` page could say
"open deadlines". With that page deleted, no caller sets those attributes and
the branch was configuration for a fixed value, so it and its regression test
were removed with the page.
```

- [ ] **Step 13: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
git add -A
git commit -m "$(cat <<'EOF'
feat: remove the deadlines page and guard the surviving routes

The events list becomes the site's only index. /deadlines.ics, the deadline
pills, the per-event deadline tables, the countdowns and the open-deadline
filter all stay. Two new tests keep the sitemap and internal links honest when
a route is deleted, and the filter island's per-page noun configuration goes
with the page that needed it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Merge the curation policy into the about page

**Files:**
- Modify: `astro.config.ts`
- Modify: `src/pages/about.astro`
- Modify: `src/pages/index.astro:30`, `src/pages/submit.astro:15`, `src/layouts/Base.astro:74`
- Modify: `src/pages/sitemap.xml.ts` (drop `/policy/`)
- Modify: `tests/pages/links.test.ts` (extend the guard)
- Modify: `docs/curation-policy.md:3`
- Modify: `docs/decisions.md` (append)
- Delete: `src/pages/policy.astro`

**Interfaces:**
- Consumes: `STATIC_PATHS` and both guard tests from Task 1.
- Produces: the anchor `/about/#curation-policy`, which Task 3's footer links to.

- [ ] **Step 1: Extend the dead-link guard to `/policy/`**

In `tests/pages/links.test.ts`, widen the pattern:

```ts
/** Routes this redesign removed. A link to one of them would 404. */
const REMOVED = /href="\/(deadlines|policy)\/"/;
```

- [ ] **Step 2: Run it — it must fail with three files**

Run: `npx vitest run tests/pages/links.test.ts`

Expected: FAIL, listing `src/pages/index.astro`, `src/pages/submit.astro` and `src/pages/about.astro`. (`Base.astro` is a layout under `src/layouts/`, which the walker also covers — expect it in the list too.)

- [ ] **Step 3: Demote the curation policy's headings when it renders inside a page**

> **Executed differently.** Astro 7 replaced the rehype pipeline with the Sätteri processor:
> `markdown.rehypePlugins` now errors unless `@astrojs/markdown-remark` is installed, and the
> replacement hook (`satteri({ hastPlugins })`) would mean importing a package the project does
> not depend on directly. The headings were demoted in `docs/curation-policy.md` itself instead,
> `astro.config.ts` was left untouched, and `docs/decisions.md` records why. The `<section
> id="curation-policy">` wrapper in step 4 was also dropped: the demoted `## Curation policy`
> heading generates that id itself, and keeping both produced a duplicate id.

`docs/curation-policy.md` opens with `# Curation policy`. Rendered inside `/about/`, which already has its own `<h1>`, that would invert the heading order. Add an inline rehype plugin to `astro.config.ts` — no dependency, no `any`:

```ts
import { defineConfig } from 'astro/config';
import { site } from './site.config';

interface HastNode {
  type: string;
  tagName?: string;
  children?: HastNode[];
}

/** Demote every heading in `docs/curation-policy.md` by one level. The file is
 * rendered inside `/about/`, under that page's `<h1>`, and is also read as a
 * standalone document on GitHub, where its own `<h1>` is correct. */
function demoteCurationPolicyHeadings() {
  return (tree: HastNode, file: { history?: string[] }): void => {
    if (!(file.history?.[0] ?? '').endsWith('curation-policy.md')) return;
    const walk = (node: HastNode): void => {
      if (node.type === 'element' && node.tagName && /^h[1-5]$/.test(node.tagName)) {
        node.tagName = `h${Number(node.tagName.slice(1)) + 1}`;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  markdown: { rehypePlugins: [demoteCurationPolicyHeadings] },
});
```

- [ ] **Step 4: Render the policy inside the about page**

In `src/pages/about.astro`, add the import beside the existing ones:

```astro
import { Content as CurationPolicy } from '../../docs/curation-policy.md';
```

Insert this section after the `Feeds and exports` list and before the `Corrections` heading:

```astro
    <section id="curation-policy">
      <CurationPolicy />
    </section>
```

In the same file, change the Corrections paragraph's link from `/policy/` to the in-page anchor:

```astro
      Every event page has a correction link and a report link. See the
      <a href="#curation-policy">curation policy</a> above for how reports are handled, or email
```

- [ ] **Step 5: Rewrite the two remaining `/policy/` links**

`src/pages/index.astro` line 30:

```astro
    the <a href="/about/#curation-policy">curation policy</a>.
```

`src/pages/submit.astro` line 15:

```astro
      submission is checked against the
      <a href="/about/#curation-policy">curation policy</a> before it appears.
```

`src/layouts/Base.astro` line 74 (the footer paragraph, which Task 3 replaces wholesale — fix it here so the guard passes now):

```astro
          Community-maintained. Listings follow the
          <a href="/about/#curation-policy">curation policy</a>.
```

- [ ] **Step 6: Delete the policy page and its sitemap entry**

```bash
git rm src/pages/policy.astro
```

In `src/pages/sitemap.xml.ts`:

```ts
export const STATIC_PATHS = ['/', '/archive/', '/about/', '/submit/'];
```

- [ ] **Step 7: Correct the file's own publication note**

`docs/curation-policy.md` line 3, first clause:

```markdown
This page is published on the site at `/about/#curation-policy`. It explains what we list, what we don't, and how listings are checked. Keep it plain and factual.
```

- [ ] **Step 8: Run the guards and the build**

Run: `npx vitest run tests/pages/links.test.ts tests/endpoints/sitemap.test.ts && npm run build`
Expected: both tests PASS; the build succeeds and emits no `dist/policy/` directory.

- [ ] **Step 9: Check the rendered heading order by eye**

Run: `grep -o '<h[1-3][^>]*>[^<]*' dist/about/index.html`

Expected: exactly one `<h1>` (`About`), and `Curation policy` appearing as an `<h2>`, with the policy's own sections as `<h3>`. If `Curation policy` is still an `<h1>`, the rehype plugin did not match the file — check the `file.history` path ending.

- [ ] **Step 10: Record the decision**

Append to `docs/decisions.md`:

```markdown
## 2026-09-21 — `/policy/` is merged into `/about/`

With the top navigation bar gone, the footer would otherwise point at two
long-form pages. The curation policy now renders inside `/about/` under
`<section id="curation-policy">`, and `/policy/` no longer exists; inbound
links became `/about/#curation-policy`. `docs/curation-policy.md` remains the
single source of the text, and an inline rehype plugin in `astro.config.ts`
demotes its headings by one level so they nest under the about page's `<h1>`
while the file still reads correctly on GitHub.
```

- [ ] **Step 11: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
git add -A
git commit -m "$(cat <<'EOF'
feat: merge the curation policy into the about page

/policy/ is deleted and docs/curation-policy.md now renders inside /about/
under an anchored section, with an inline rehype plugin demoting its headings
so they nest under that page's h1. Inbound links point at
/about/#curation-policy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rebuild the chrome — masthead, footer, inline action row

**Files:**
- Create: `src/components/PageActions.astro`
- Modify: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/archive.astro`
- Modify: `src/styles/global.css` (structure only; colours are Task 4)
- Modify: `tests/pages/links.test.ts` (add the no-nav assertion)

**Interfaces:**
- Consumes: `/about/#curation-policy` from Task 2.
- Produces: `PageActions.astro` with `Props { actions: { href: string; label: string }[] }`, used by `/` and `/archive/`.

- [ ] **Step 1: Write the failing assertion that the nav bar is gone**

Append to the `describe('internal links', ...)` block in `tests/pages/links.test.ts`:

```ts
  it('has no site navigation bar in the layout', () => {
    const layout = readFileSync('src/layouts/Base.astro', 'utf8');
    expect(layout).not.toMatch(/class="site-nav"/);
    expect(layout).not.toMatch(/aria-label="Main"/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/pages/links.test.ts`
Expected: FAIL — `Base.astro` still renders `<nav class="site-nav" aria-label="Main">`.

- [ ] **Step 3: Create the action-row component**

Create `src/components/PageActions.astro`:

```astro
---
export interface Action {
  href: string;
  label: string;
}

interface Props {
  actions: Action[];
}

const { actions } = Astro.props;
---

<!-- A plain list, deliberately not a <nav>: these are controls for this page,
     and a second navigation landmark would compete with the footer. -->
<ul class="actions mono">
  {actions.map((action) => (
    <li>
      <a href={action.href}>{action.label}</a>
    </li>
  ))}
</ul>
```

- [ ] **Step 4: Replace the masthead and footer in `Base.astro`**

Delete the `nav` array from the frontmatter (lines 16-23). Keep every other frontmatter line — `path` still builds `canonical` and `fullTitle`. Replace the `<header>` and `<footer>` elements with:

```astro
    <header class="site-head">
      <div class="site-head__inner">
        <a class="site-head__name" href="/">
          {site.name}
        </a>
        <p class="site-head__tagline mono">{site.tagline}</p>
      </div>
    </header>

    <main id="main" class="wrap">
      <slot />
    </main>

    <footer class="site-foot">
      <div class="site-foot__inner">
        <section class="site-foot__col">
          <h2 class="site-foot__head mono">About</h2>
          <p>
            A community-maintained calendar of conferences, workshops and schools in
            computational and theoretical chemistry. No accounts, no cookies, no tracking.
          </p>
          <p>
            <a href="/about/">About this site</a>
          </p>
        </section>

        <section class="site-foot__col">
          <h2 class="site-foot__head mono">Contribute</h2>
          <ul>
            <li><a href="/submit/">Add an event</a></li>
            <li><a href="/about/#curation-policy">Curation policy</a></li>
            <li><a href={site.repoUrl} rel="noopener">Source</a></li>
          </ul>
        </section>

        <section class="site-foot__col">
          <h2 class="site-foot__head mono">Feeds</h2>
          <ul>
            <li><a href="/events.ics">Events calendar</a></li>
            <li><a href="/deadlines.ics">Deadlines calendar</a></li>
            <li><a href="/feed.xml">Atom feed</a></li>
            <li><a href="/events.json">JSON export</a></li>
          </ul>
        </section>
      </div>
    </footer>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/pages/links.test.ts`
Expected: PASS.

- [ ] **Step 6: Put the action row on the home page**

In `src/pages/index.astro`, add to the imports:

```astro
import PageActions from '../components/PageActions.astro';
```

and replace the `<p class="result-count" ...>` element with it wrapped in a header row (the `id` and the `data-*`-free markup must stay exactly as they are — `filters.ts` looks up `#result-count`):

```astro
      <div class="listing-head">
        <p class="result-count" id="result-count" role="status" aria-live="polite">
          {events.length} upcoming {events.length === 1 ? 'event' : 'events'}
        </p>
        <PageActions
          actions={[
            { href: '/submit/', label: 'Add an event' },
            { href: '/archive/', label: 'Archive' },
            { href: '/events.ics', label: 'Subscribe (.ics)' },
          ]}
        />
      </div>
```

- [ ] **Step 7: Put the action row on the archive page**

In `src/pages/archive.astro`, add the same import, then insert after the `<p class="muted">Events that have already finished, newest first.</p>` line:

```astro
  <PageActions
    actions={[
      { href: '/', label: 'Upcoming events' },
      { href: '/submit/', label: 'Add an event' },
    ]}
  />
```

- [ ] **Step 8: Add the structural CSS**

In `src/styles/global.css`, delete the `.site-nav`, `.site-nav a` and `.site-nav a:hover, .site-nav a[aria-current='page']` rules. Replace them with:

```css
.site-head__inner {
  display: block;
}

.site-head__tagline {
  margin: 0.15rem 0 0;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.site-foot__inner {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-l);
  align-items: start;
}

.site-foot__col p {
  margin-block-end: var(--space-xs);
}

.site-foot__head {
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--fg-muted);
  margin-block-end: var(--space-s);
}

.site-foot__col ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-xs);
}

.listing-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-s) var(--space-m);
  align-items: baseline;
  justify-content: space-between;
  margin-block-end: var(--space-s);
}

.listing-head .result-count {
  margin: 0;
}

.actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-m);
  font-size: var(--step--1);
}

@media (max-width: 52rem) {
  .site-foot__inner {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-m);
  }
}
```

The existing `.site-head__inner, .site-foot__inner` shared rule sets `display: flex` — the two rules above override it per element, so leave the shared rule in place for its width and padding.

- [ ] **Step 9: Build and look at the output**

Run: `npm run build && grep -c 'site-nav' dist/index.html; grep -o 'class="actions[^"]*"' dist/index.html | head -1`

Expected: `grep -c` prints `0`; the second grep prints `class="actions mono"`.

- [ ] **Step 10: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
git add -A
git commit -m "$(cat <<'EOF'
feat: replace the nav bar with a masthead, footer columns and page actions

The top menu bar is gone. The masthead keeps the wordmark and tagline, the
footer carries About, Contribute and Feeds columns, and /' and /archive/ get an
inline action row beside their heading that reads as page controls rather than
site navigation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Repaint — dark-only orbital palette with a contrast test

**Files:**
- Create: `tests/styles/contrast.test.ts`
- Modify: `src/styles/global.css` (token block, light-mode block, every `var(--warm)` / `var(--cool)` reference)
- Modify: `docs/decisions.md` (append)

**Interfaces:**
- Consumes: the structural CSS from Task 3.
- Produces: the token names `--bg`, `--bg-raise`, `--fg`, `--fg-muted`, `--rule`, `--rule-strong`, `--control`, `--lobe-neg`, `--lobe-neg-soft`, `--lobe-pos`, `--lobe-pos-soft`, `--link`, `--time`. Task 5 uses `--lobe-neg` and `--lobe-pos` for the background motifs.

- [ ] **Step 1: Write the failing contrast test**

Create `tests/styles/contrast.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/global.css', 'utf8');

/** Reads a `--name: #rrggbb;` declaration out of the stylesheet. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`token --${name} is missing or is not a 6-digit hex colour`);
  return match[1]!;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('palette contrast', () => {
  it.each([
    ['fg', 'bg', 4.5],
    ['fg-muted', 'bg', 4.5],
    ['fg-muted', 'bg-raise', 4.5],
    ['lobe-neg', 'bg', 4.5],
    ['lobe-pos', 'bg', 4.5],
    ['control', 'bg-raise', 3],
  ])('--%s on --%s meets %s:1', (fg, bg, min) => {
    expect(ratio(token(fg as string), token(bg as string))).toBeGreaterThanOrEqual(min as number);
  });

  it('is dark only', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*light/);
  });

  it('routes the semantic aliases to the two lobes', () => {
    expect(css).toMatch(/--link:\s*var\(--lobe-neg\)/);
    expect(css).toMatch(/--time:\s*var\(--lobe-pos\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/styles/contrast.test.ts`
Expected: FAIL — `token --control is missing`, plus the dark-only and alias assertions failing against the current stylesheet.

- [ ] **Step 3: Replace the token block**

In `src/styles/global.css`, replace the colour half of `:root` (from the `/* Dark theme: ... */` comment through `--cool-soft`) with:

```css
  /* Orbital isosurface: the two phase lobes on a plotted dark ground.
     --lobe-neg (blue) is the interactive colour; --lobe-pos (red) marks time
     and anything that needs attention, so red stays scarce enough to mean
     something. Ratios are asserted in tests/styles/contrast.test.ts. */
  --bg: #06080c;
  --bg-raise: #0e141c;
  --fg: #dfe6ee;
  --fg-muted: #8b9aab;
  --rule: #182231;
  --rule-strong: #2a3a4d;
  --control: #5b6d80;

  --lobe-neg: #7ab6ff;
  --lobe-neg-soft: #0d1f36;
  --lobe-pos: #ff7a68;
  --lobe-pos-soft: #2e100c;

  --link: var(--lobe-neg);
  --time: var(--lobe-pos);
```

and change the first declaration in `:root` from `color-scheme: dark light;` to `color-scheme: dark;`.

- [ ] **Step 4: Delete the light-mode block**

Remove the entire `@media (prefers-color-scheme: light) { :root { ... } }` block.

- [ ] **Step 5: Re-point every old token reference**

Replace throughout `src/styles/global.css`:

| Old | New | Occurrences |
|---|---|---|
| `var(--cool)` | `var(--link)` | `a`, `.pill--topic` border and colour, `.event__title a:hover`, `.prose blockquote` border, the body background's first lobe (Task 5 rewrites that one) |
| `var(--cool-soft)` | `var(--lobe-neg-soft)` | `.pill--topic` background |
| `var(--warm)` | `var(--time)` | `:focus-visible` outline, `.event__when`, `.pill--deadline` border and colour, `.pill--status`, `.warn`, `.filters__clear`, the body background's second lobe (Task 5 rewrites that one) |
| `var(--warm-soft)` | `var(--lobe-pos-soft)` | `.pill--deadline` background |

Then change the control borders from `--rule-strong` to the new token:

```css
.filters input[type='text'],
.filters input[type='date'],
.filters select {
  border: 1px solid var(--control);
}
```

Leave `.pill` (the neutral pill) on `--rule-strong`: it is a decorative boundary, not an interactive control.

- [ ] **Step 6: Run the contrast test to verify it passes**

Run: `npx vitest run tests/styles/contrast.test.ts`
Expected: PASS, all six ratio cases plus the dark-only and alias cases.

- [ ] **Step 7: Confirm no token reference was missed**

Run: `grep -n 'var(--warm\|var(--cool' src/styles/global.css src/**/*.astro`
Expected: no output.

- [ ] **Step 8: Record the decision**

Append to `docs/decisions.md`:

```markdown
## 2026-09-21 — Dark-only palette built on the two orbital phase lobes

The 2026-09-20 spec's section 8 specified dark-first with a warm-paper light
mode. The redesign drops the light mode: the site's visual metaphor is a
rendered isosurface on a dark ground, and a second theme that contradicts it
costs more to maintain than it returns. Tokens are now `--lobe-neg` (blue,
aliased as `--link`) and `--lobe-pos` (red, aliased as `--time`), with a new
`--control` token for interactive borders because the old `--rule-strong`
missed WCAG 1.4.11's 3:1 boundary requirement. `tests/styles/contrast.test.ts`
asserts every ratio against the shipped values, so a future colour edit that
breaks AA fails the suite.
```

- [ ] **Step 9: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
git add -A
git commit -m "$(cat <<'EOF'
feat: repaint the site in dark-only orbital phase colours

Blue carries links and topics, red carries dates, deadlines, status and the
focus ring. The light theme is gone, a --control token fixes the interactive
border contrast, and a new test asserts every WCAG ratio against the shipped
token values.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Isosurface field and contour substrate

**Files:**
- Modify: `src/styles/global.css` (`body` background, `.site-head`)

**Interfaces:**
- Consumes: `--lobe-neg` and `--lobe-pos` from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Replace the body background with the two phase lobes**

In `src/styles/global.css`, replace the existing `background-image` on `body`:

```css
  /* Atmosphere: the two phase lobes of an isosurface, plus a dim third lobe low
     on the page so the ground has depth rather than a flat vignette. Pure CSS,
     no image bytes, no requests. */
  background-image:
    radial-gradient(
      62% 40% at 12% -8%,
      color-mix(in oklab, var(--lobe-neg) 16%, transparent),
      transparent 70%
    ),
    radial-gradient(
      52% 34% at 92% 4%,
      color-mix(in oklab, var(--lobe-pos) 13%, transparent),
      transparent 70%
    ),
    radial-gradient(
      70% 30% at 50% 108%,
      color-mix(in oklab, var(--lobe-neg) 8%, transparent),
      transparent 72%
    );
```

Leave `background-attachment: fixed` and `background-repeat: no-repeat` as they are.

- [ ] **Step 2: Give the masthead its plotted substrate**

Add after the `.site-head__tagline` rule:

```css
.site-head {
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

/* A plotting grid crossed with density contours. Masked to nothing before it
   reaches the wordmark, and marked aria-hidden by being a pseudo-element. */
.site-head::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    repeating-linear-gradient(
      to right,
      color-mix(in oklab, var(--lobe-neg) 22%, transparent) 0 1px,
      transparent 1px 34px
    ),
    repeating-linear-gradient(
      to bottom,
      color-mix(in oklab, var(--lobe-neg) 22%, transparent) 0 1px,
      transparent 1px 34px
    ),
    repeating-radial-gradient(
      circle at 88% 120%,
      color-mix(in oklab, var(--lobe-pos) 30%, transparent) 0 1px,
      transparent 1px 22px
    );
  opacity: 0.5;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.9), transparent 88%);
}
```

- [ ] **Step 3: Set tabular figures on the mono layer**

The `.mono` rule already sets `font-variant-numeric: tabular-nums`. Confirm it, and add the instrument-panel treatment for the action row and result count:

```css
.result-count,
.actions {
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.actions a {
  color: var(--fg-muted);
  text-decoration: none;
  border-block-end: 1px solid color-mix(in oklab, var(--link) 45%, transparent);
  padding-block-end: 0.15em;
}

.actions a:hover {
  color: var(--link);
  border-block-end-color: var(--link);
}
```

- [ ] **Step 4: Build and confirm no network request was introduced**

Run: `npm run build && grep -rn 'url(' dist/_astro/*.css | grep -v 'data:' | head`
Expected: no output — the stylesheet references no external asset.

- [ ] **Step 5: Confirm the reduced-motion guard still holds**

Run: `grep -n 'prefers-reduced-motion' src/styles/global.css`
Expected: one match, wrapping the `.reveal` animation rules, unchanged.

- [ ] **Step 6: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
git add -A
git commit -m "$(cat <<'EOF'
feat: add the isosurface field and masthead contour substrate

The page ground carries two phase lobes and a dim third for depth; the masthead
carries a plotting grid crossed with density contours, masked out before it
reaches the wordmark. CSS only: no images, no requests, no new bytes over the
wire beyond the stylesheet itself.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Whole-site verification sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-site-redesign-design.md` (correct one row of the files-touched table)

**Interfaces:**
- Consumes: everything above.
- Produces: the final report.

- [ ] **Step 1: Run the full gate**

```bash
npm run lint && npm run typecheck && npm run validate && npm test && npm run build
```

Expected: all five pass.

- [ ] **Step 2: Prove the removed routes are gone and the kept ones remain**

```bash
test ! -d dist/deadlines && test ! -d dist/policy && echo "routes removed"
grep -c BEGIN:VEVENT dist/deadlines.ics
grep -o '<loc>[^<]*</loc>' dist/sitemap.xml | head -5
grep -rn 'href="/deadlines/"\|href="/policy/"' dist/ | head
```

Expected: `routes removed`; a VEVENT count of 1 or more; the sitemap's first entries being `/`, `/archive/`, `/about/`, `/submit/`; and **no output** from the last grep.

- [ ] **Step 3: Prove the deadline information survived the page's deletion**

```bash
grep -c 'pill--deadline' dist/index.html
grep -c 'data-countdown' dist/index.html
grep -o 'name="deadline"' dist/index.html | head -1
```

Expected: a non-zero pill count, a non-zero countdown count, and the open-deadline filter checkbox still present.

- [ ] **Step 4: Confirm the page is complete without JavaScript**

```bash
grep -c '<li class="event"' dist/index.html
```

Expected: the same number as the upcoming-event count printed in `dist/index.html`'s `#result-count` — every event is server-rendered, so the list is complete with scripting off.

- [ ] **Step 5: Report the contrast ratios as numbers**

Run: `npx vitest run tests/styles/contrast.test.ts --reporter=verbose`

Expected: each ratio case named and passing. Record the six ratios in the final report from the spec's section 5 table, confirming the shipped values match.

- [ ] **Step 6: Correct the spec's files-touched table**

`README.md` and `CONTRIBUTING.md` link `docs/curation-policy.md` as a file, not the `/policy/` route, and neither mentions the deadlines page — so neither needs editing. Change the `README.md` row of the spec's section 7 table to:

```markdown
| `README.md` | No change needed: it links the policy *file*, not the route, and never mentions the deadlines page. Verified in Task 6. |
```

- [ ] **Step 7: Commit the correction**

```bash
git add docs/superpowers/specs/2026-09-21-site-redesign-design.md
git commit -m "$(cat <<'EOF'
docs: correct the spec's files-touched table

README.md and CONTRIBUTING.md link the curation policy file rather than the
/policy/ route, so neither needed editing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Summarise for the maintainer**

Report: the branch name, the commits, the six contrast ratios, the routes deleted, confirmation that `/deadlines.ics` and every per-event deadline surface still works, and the one deferred item (per-event images, spec D7).

---

## Self-Review

**Spec coverage:** section 3 routes → Tasks 1, 2; section 4 layout → Task 3; section 5 palette → Task 4; section 6 motifs → Task 5; section 7 files touched → all tasks, with the `README.md` row corrected in Task 6; section 8 verification → Task 6, plus per-task gates. D1 → Task 1; D2 → Task 2; D3 → Task 3; D4 → Task 4; D5 → Task 1 steps 9-11; D6 → the global constraint forbidding `@font-face`; D7 → out of scope, restated in Task 6's report.

**Placeholders:** none. Every code step carries the literal code.

**Type consistency:** `STATIC_PATHS` is exported in Task 1 step 1 and imported under that name in Task 1 step 2 and edited in Task 2 step 6. `PageActions` takes `actions: { href, label }[]` in Task 3 step 3 and is called with exactly that shape in steps 6 and 7. The token names introduced in Task 4 step 3 are the ones Task 4 step 5 re-points to and Task 5 consumes.
