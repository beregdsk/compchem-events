# Design: computational chemistry events site, v1

Date: 2026-09-20 · Status: **draft, pending maintainer edit** · Supersedes nothing; refines `TASK.md`

## 1. Goal

A community-maintained static website aggregating conferences, workshops, schools and
symposia in computational and theoretical chemistry. Readers are researchers, chiefly PhD
students and postdocs, who want upcoming events and deadlines in one filterable place,
exportable to their calendar.

Success: a visitor filters upcoming events by topic, region, format and deadline, opens an
event, adds it or its deadlines to a calendar, and can report a suspicious listing. A
contributor adds an event in one small pull request. Hosting costs approximately nothing.

## 2. Settled decisions (inherited from `TASK.md`, not reopened)

Astro with static output · TypeScript strict · current Node LTS · Cloudflare Pages ·
YAML files in `data/events/` as the single source of truth, no database · client-side
filtering in vanilla TypeScript with state in the URL · no backend, no accounts, no
ratings, no analytics, no cookies, no third-party scripts · reports via an external form
service reached by a plain link · English only.

## 3. Decisions made in this brainstorm

| # | Decision | Reason |
|---|---|---|
| D1 | **v1 is phases 0-3.** Phase 4 (link-check cron, rebuild cron, Playwright, issue forms, duplicate-detection CI) becomes a follow-up. | Phase 4 is infrastructure around a site that does not exist yet, and several parts cannot be verified until a GitHub repo and Cloudflare deploy hook exist. |
| D2 | **System font stack retained.** `CLAUDE.md`'s instruction to avoid system fonts is explicitly overridden for this project. | Maintainer decision. Zero font bytes and absolute privacy purity outweigh typographic range here. Must be recorded in `docs/decisions.md` so it is not reopened. |
| D3 | **Seed data: 3 `fixture: true` events plus 10-15 verified real events.** Deviates from `TASK.md`'s 15-30. | Every real entry costs a verified page fetch under `AGENTS.md` rule 1. 10-15 exercises filters, regions, topics and deadlines fully; the curation policy holds that a missing listing costs less than an under-verified one. |
| D4 | **Filter semantics: OR within a category, AND across categories.** | `TASK.md` lists the controls but not their combination. This is standard faceted-search behaviour and the only reading under which "Clear filters" has an obvious meaning. |
| D5 | **`schema_version: 1` emitted in `/events.json` from day one.** | `docs/data-schema.md` promises the field exists for future bumps but omits it from the example. Emitting it immediately avoids a breaking addition later. |
| D6 | **`regionOf(country)` stays pure and geographic; `Online` is derived in the loader.** | `docs/data-schema.md` asks one function to depend on both country and format. Splitting keeps the lookup table testable against ISO codes alone. |
| D7 | **Visual direction: "Isosurface"** (section 8). | Maintainer to edit freely. |
| D8 | **Local git with one branch per phase**, merged `--no-ff` into `main`. | No GitHub remote exists yet. Branch-per-phase preserves the history `TASK.md` wants and pushes cleanly once the repo is created. |

## 4. Architecture

### Modules

| Unit | Responsibility | Depends on |
|---|---|---|
| `site.config.ts` | Every site-specific value: name, tagline, production URL, contact email, repo URL, `reportForm` (url + param names for event ID and URL), `submissionFormUrl`. Nothing else may hard-code these. | nothing |
| `schema/event.schema.json` | JSON Schema 2020-12. The structural contract, implementing `docs/data-schema.md` exactly. | nothing |
| `scripts/validate.ts` | Schema validation plus the eight semantic rules. CLI **and** library, exporting `validateEvent`. | schema, `data/topics.yaml`, `data/blocklist.yaml` |
| `src/lib/dates.ts` | UTC calendar-date parsing, comparison and arithmetic. The only place dates are parsed. | nothing |
| `src/lib/regions.ts` | `regionOf(country)` lookup table, ISO alpha-2 to geographic region. | nothing |
| `src/lib/events.ts` | The single loader: parse YAML, validate, drop `fixture: true` in production, sort, derive `status` and `region`. | validate, dates, regions |
| `src/lib/ical.ts` | iCalendar serialisation: folding, escaping, exclusive `DTEND`, stable UIDs. | dates, site.config |
| `src/pages/**` | Routes, feeds and exports. Thin by rule. | events, ical, site.config |
| `src/scripts/filters.ts` | The single client-side island. | nothing (reads the DOM) |

### Build-time flow

```
data/events/**/*.yaml
  -> parse (YAML)
  -> validateEvent  ── any error ──> build FAILS, naming file path and field
  -> drop fixture:true when building for production
  -> sort by start_date
  -> derive status (upcoming | ongoing | past) from build date in UTC
  -> derive region (format === 'online' ? 'Online' : regionOf(location.country))
  -> typed Event[]  ->  pages, feeds, exports
```

### Runtime flow

Every upcoming event renders **server-side** as a real list item carrying
`data-topics`, `data-region`, `data-country`, `data-format`, `data-type`,
`data-start`, `data-deadline`.

The island reads the URL query on load, toggles a `hidden` attribute per node, writes the
result count into an `aria-live` region, and `pushState`s on change. **Nothing is rendered
client-side.** With JavaScript disabled the complete list is present and readable; the
failure mode is "no filtering", never "no content". This also keeps the island to a few kB,
well under the 30 kB budget.

### Invariants

1. Dates in data are ISO `YYYY-MM-DD` strings, parsed and compared as UTC calendar dates, never through the local timezone.
2. A build fails on invalid data. There is no partial build.
3. `fixture: true` never reaches a production build.
4. The built output makes no network requests at runtime.
5. `site.config.ts` is the only source of site-specific values.

### Error handling

`scripts/validate.ts` collects **all** problems rather than failing on the first, names the
file path and field for every one, exits non-zero on errors, and exits zero on warnings.
The loader surfaces validator errors as a build failure. The client island is defensive: any
exception leaves every event visible.

## 5. Data model

`docs/data-schema.md` is the contract and is implemented exactly, with three corrections
folded in:

- **C1.** `regionOf` split per D6: the table maps country to geographic region; the loader derives `Online`.
- **C2.** `schema_version: 1` added to the `/events.json` envelope per D5.
- **C3.** Documentation files move from the repo root into `docs/` to match every existing cross-reference in `README.md`, `CONTRIBUTING.md` and `AGENTS.md`, and `pull_request_template.md` moves to `.github/`. No content changes.

Controlled vocabulary, deadline objects, the eight error rules and four warning rules are
implemented as written.

## 6. Pages

| Route | Contents |
|---|---|
| `/` | Upcoming and ongoing events by start date. Filters: free text (title, organiser, city), topics (multi), region, country, format, type, date range, open-deadline toggle. Result count in an `aria-live` region, plus "Clear filters". |
| `/events/<id>/` | Full detail, deadlines table with timezone (`AoE` expanded to "Anywhere on Earth"), report link, correction link, last-verified date, schema.org `Event` JSON-LD. |
| `/deadlines/` | Upcoming deadlines across all events, soonest first, topic filter. |
| `/archive/` | Past events grouped by year, newest year first. |
| `/about/`, `/submit/`, `/policy/`, `404` | Static. `/policy/` renders `docs/curation-policy.md`. `/submit/` documents the three contribution routes. |
| `sitemap.xml`, `robots.txt` | Generated. Canonical URLs and OpenGraph tags on every page. |

### URL contract

```
/?q=solvation&topics=dft,catalysis&region=Europe&country=DE&format=hybrid&type=workshop&from=2026-11-01&to=2027-06-30&deadline=open
```

Empty parameters are omitted, so an unfiltered view stays at `/`.

### Behaviour

- **Countdowns** are computed client-side from the ISO date so they cannot go stale between builds. Server HTML carries the plain date in `<time datetime>`; the island upgrades it in place.
- **Stale notice** appears when `last_verified` is more than 90 days old and the event has not started: a subtle note asking the reader to check the official page.
- **Cancelled and postponed** events remain listed, visibly marked, with `status_note` shown. `STATUS:CANCELLED` propagates to the `.ics`.

### Non-functional

Responsive to 360 px · keyboard navigable · WCAG AA contrast · respects
`prefers-color-scheme` and `prefers-reduced-motion` · under 30 kB gzipped JS on `/`.

Lighthouse mobile >= 95 across performance, accessibility, best practices and SEO is the
target. **Caveat:** producing real scores requires a working headless Chrome in the build
environment. If it is unavailable, the final report says so rather than omitting the check
silently or reporting unverified numbers.

## 7. Feeds and exports

Per `TASK.md`, unchanged:

- `/events.ics` — upcoming events as all-day entries.
- `/deadlines.ics` — upcoming deadlines as all-day entries titled `[Abstract deadline] <title>`.
- `/feed.xml` — Atom feed of newly added events by `added`, newest first.
- `/events.json` — full public dataset, stable field names, `generated_at`, `count`, `schema_version`, plus `region` and `status_derived` per event.

iCalendar requirements: CRLF line endings, lines folded at 75 octets, commas, semicolons and
newlines escaped in text, `DTSTART;VALUE=DATE` for all-day entries, **`DTEND` exclusive**
(end date plus one day), UIDs of `<id>@<domain>` and `<id>-<deadline-type>@<domain>`,
`STATUS:CANCELLED` where applicable, `X-WR-CALNAME` set. `AoE` deadlines use that date and
say "AoE" in the description.

## 8. Visual direction — "Isosurface"

*Maintainer to edit freely; this is a starting position, not a constraint.*

Colour and structure carry the entire aesthetic, since D2 rules out custom typography.

- **Ground:** deep desaturated blue-black, not pure black, with a very low-contrast layered radial gradient suggesting an electron-density lobe. Pure CSS, zero JS, zero image bytes.
- **Accents:** the two classic molecular-orbital phase colours. Warm amber for deadlines and urgency; cool teal for topics and links. Domain-meaningful rather than decorative.
- **Typography:** system UI stack for prose; the **system monospace** stack for dates, event IDs, countdowns and the deadline table — character where it also buys tabular alignment.
- **Structure:** hairline rules, no cards and no shadows. Events are dense rows in a grid. Filters in a left rail on desktop, collapsing to a disclosure on mobile.
- **Light theme:** warm paper, not white.
- **Motion:** staggered load-in via `animation-delay`, hairline underline transitions, all behind `prefers-reduced-motion`.

All colours as CSS custom properties on `:root`, redefined under `prefers-color-scheme`.

## 9. Testing

- **Unit (Vitest):** `dates` (UTC correctness, including month and year boundaries), `regions` (every code in the table is a valid ISO alpha-2), `events` loader (sorting, status derivation, fixture exclusion, region derivation), `ical` (folding at 75 octets, escaping, exclusive `DTEND`).
- **Fixtures:** `tests/fixtures/valid/` and `tests/fixtures/invalid/`. Each invalid fixture carries a comment naming the error it should trigger, and a test asserts precisely that error is reported.
- **Round-trip:** both `.ics` outputs are parsed back with a real iCalendar library, asserting entry counts, dates including the exclusive `DTEND`, and UID stability.
- **Gates before every commit:** `lint`, `typecheck`, `validate`, `test`, `build`.

## 10. Repository and workflow

`git init` locally. One branch per phase (`feat/phase-N-<slug>`), merged `--no-ff` into
`main`, Conventional Commits throughout. When the GitHub repository exists, the history
pushes cleanly and reads as intended. `docs/decisions.md` is created in phase 0 and records
D1-D8, D2 especially, so the typography question is not reopened.

Two items listed under phase 4 in `TASK.md` are **not** deferred with it, because phases 0-3
cannot be honest without them: `README.md`'s command list must work from a clean checkout,
and `docs/decisions.md` must be current at the end of the last phase shipped. Both are
finished as part of phase 3.

## 11. Out of scope

Phase 4 (deferred follow-up): weekly link-check workflow, daily Cloudflare rebuild cron,
duplicate-detection CI, GitHub issue forms, Playwright smoke test.

Phase 5 (separate task): the discovery agent, specified in `docs/discovery-agent.md`. v1's
only obligations toward it are keeping `validateEvent` importable as a library and keeping
`data/` free of anything an automated pull request would trip over. Both are satisfied.

Permanently out: any server or backend code, databases, accounts, ratings, paid listings,
analytics, translations.

## 12. Blocked on the maintainer

These cannot be done from here and are carried as clearly marked placeholders in
`site.config.ts`:

1. Final site name and domain.
2. Public GitHub repository.
3. Cloudflare Pages connection (build `npm run build`, output `dist`, Node pinned to `.nvmrc`).
4. Report form and submission form URLs, with their query-parameter names.
5. Licence choice. Suggested: MIT for code, CC0 or CC BY 4.0 for data. No `LICENSE` file is added until decided.
6. `CF_DEPLOY_HOOK` secret — needed only for the deferred phase 4.
