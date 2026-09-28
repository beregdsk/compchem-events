# Repository map

What every file and folder in this repository is for. This is the one place
that describes the layout — `README.md` and `AGENTS.md` point here rather than
repeating it.

If you add a file, add a line here. If a description here disagrees with the
code, the code is right and this file is stale: fix it.

## The shape of the thing

A static site. Event data lives in YAML files, a validator enforces a JSON
Schema over them, Astro renders them to HTML at build time, and a Cloudflare
Worker serves the output as static assets. There is no server, no database and no runtime data
fetching. Every page you can reach is a file that existed before the visitor
arrived.

Separately, a discovery agent (`scripts/discovery/run.ts` over
`src/lib/discovery/`) runs as a cron job on the maintainer's VDS: it reads
`data/sources.yaml`, finds candidate events and opens pull requests for human
review. It never publishes, and nothing in the built site depends on it.

The data flows one way:

```
data/events/*.yaml  →  scripts/validate.ts  (gate: build fails on invalid data)
                    →  src/lib/events.ts    (the single loader)
                    →  src/pages/*          (routes, feeds, exports)
                    →  dist/                (what gets deployed)
```

## Top level

| Path | What it is |
| --- | --- |
| `README.md` | Front door: what the project is, how to run it, where the docs are. |
| `METADATA.md` | This file. |
| `LICENSE` | MIT, for the code. |
| `AGENTS.md` | Rules for coding agents: ground rules, code style, definition of done. Read it before changing anything. |
| `CLAUDE.md` | Frontend aesthetic instructions applied to this repo. |
| `CONTRIBUTING.md` | How a human contributor adds or corrects an event. |
| `TASK.md` | The original build brief, phase by phase. Historical, but phases 4-5 are still the roadmap. |
| `site.config.ts` | Every site-specific setting: name, domain, form URLs. The only place such values belong. |
| `astro.config.ts` | Astro build configuration. |
| `tsconfig.json` | TypeScript configuration (strict). |
| `vitest.config.ts` | Test runner configuration. |
| `playwright.config.ts` | Config for the one browser-driven smoke test. Builds against a production build via `npm run preview`. |
| `eslint.config.js` | Lint rules. |
| `.prettierrc.json` / `.prettierignore` | Formatting rules, and the pre-existing docs exempted from them. |
| `.nvmrc` | The Node version the project is built and tested against. |
| `package.json` / `package-lock.json` | Scripts and dependencies, and their locked versions. `npm run` targets are listed in `README.md`. |
| `wrangler.jsonc` | Cloudflare Worker config: serves `dist/` as static assets. There is no Worker script. |
| `Dockerfile.discovery` / `.dockerignore` | Image for the discovery agent's cron job, running as an unprivileged user with no credentials baked in. See *Deployment* in `docs/discovery-agent.md`. |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.astro/`, `.env*`, logs, `.superpowers/`, and the Playwright run artifacts (`test-results/`, `playwright-report/`). |

## `data/` — the source of truth

Everything the site knows. Editing a file here and rebuilding is the whole
publishing workflow.

| Path | What it is |
| --- | --- |
| `data/events/<start-year>/<id>.yaml` | One file per event. The folder must match the event's start year and the filename must match its `id`; the validator enforces both. |
| `data/topics.yaml` | Controlled vocabulary of topic slugs and labels. Adding a slug is a schema-level change. |
| `data/blocklist.yaml` | Organiser domains that must never be listed, each with public evidence. Intentionally empty until there is something to add. Matches a registrable host and its subdomains. |
| `data/sources.yaml` | Pages, feeds, channels and mailing lists the discovery agent watches, each verified by fetch. Read by `src/lib/discovery/sources.ts`, listed publicly on `/sources/`, and checked by `npm run validate`. Unusable candidates are kept in a commented block at the bottom so nobody re-checks them. |
| `data/LICENSE` | CC0 1.0, for the event data in this directory. |

## `schema/`

| Path | What it is |
| --- | --- |
| `schema/event.schema.json` | JSON Schema for an event file. The contract. Changing it means changing the validator, `docs/data-schema.md`, the fixtures and the tests in the same pull request. |

## `scripts/`

| Path | What it is |
| --- | --- |
| `scripts/validate.ts` | CLI entry point for `npm run validate`. Walks `data/events/` and checks `data/sources.yaml`, reports problems and exits non-zero on any error. Thin: the logic is in `src/lib/validation.ts` and `src/lib/discovery/sources.ts` so the discovery agent can import it as a library. |
| `scripts/discovery/run.ts` | The discovery agent's cron entry point (`npm run discover:run`): validates its environment, then runs fetch → extract → classify → open pull requests → label high-confidence ones. |
| `scripts/discovery/parse-sources.ts` | Dry run (`npm run discover`): fetches and extracts from every source and prints the candidates as JSON. No classification, no GitHub calls. |
| `scripts/discovery/classify.ts` | CLI: reads one candidate event file (YAML or JSON), classifies it against `data/events/` and `data/blocklist.yaml` via `src/lib/discovery/classify-candidate.ts`, prints the verdict as JSON. Useful for checking one candidate by hand; `orchestrator.ts` calls the same classifier in a real run. |
| `scripts/check-links.ts` | CLI: fetches every `url`/`source_url` (or just the files given on the command line) and reports which don't resolve. Never fails — used both by the weekly link-check workflow and the pull-request check on changed files. |

## `src/lib/` — pure logic, unit tested

No DOM, no Astro, no side effects beyond reading files. This is where
behaviour lives and where tests point.

| Path | What it does |
| --- | --- |
| `dates.ts` | The only place dates are parsed. ISO `YYYY-MM-DD` strings handled as UTC calendar dates, never through the local timezone. Parsing, arithmetic, comparison, formatting. |
| `events.ts` | The single data loader. Reads and parses the YAML tree, derives each event's status, and splits upcoming from past. Also computes upcoming deadlines and staleness. |
| `validation.ts` | Schema validation (Ajv) plus the semantic rules the schema cannot express — end before start, deadline after end, unknown topic or country, `added` after `last_verified`, id/filename/folder agreement. Exported as `validateEvent` for reuse. |
| `event-graph.ts` | Similarity between events (shared topics, series, organiser) and the graph built from it. Feeds `/graph/` and the related events on each event page. |
| `graph-layout.ts` | Seeded d3-force layout for the event map, run at build time; the browser script reuses its force configuration. |
| `graph-shapes.ts` | SVG path per event type for the map: type is carried by shape, not colour. |
| `discovery/jev-client.ts` | Thin client for OpenRouter's Decisions API (the `jev` model): builds the request, checks for a 2xx response and an `answers` field, otherwise throws. |
| `discovery/classify-candidate.ts` | Decides add/skip for one candidate event: a mechanical dedupe/blocklist pre-filter, then a single jev call scoring relevance, red flags, and credibility as three independent criteria (organiser, programme, cost). Never publishes anything — produces the verdict `orchestrator.ts` acts on. See `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`. |
| `discovery/sources.ts` | Loads `data/sources.yaml` (skipping malformed entries at run time) and validates it (`validateSources`, the CI gate). Owns `SOURCE_KINDS`. |
| `discovery/pipeline.ts` | Fetch → parse → extract → validate for every source, four at a time, under page and token caps. Returns candidates and per-source errors. |
| `discovery/fetch.ts` | Polite fetching: robots.txt, per-host rate limit, ETag/hash caching, and a browser fallback when a page looks like a bot challenge. |
| `discovery/browser-fetch.ts` | Renders a page in the system's Chrome via Playwright, for sites that block plain HTTP clients. |
| `discovery/http.ts` | `fetchWithTimeout`: every outbound call goes through it, since plain `fetch` can hang forever. |
| `discovery/state.ts` | The run-to-run state file: each page's ETag and content hash, each host's robots.txt and last request time. Never throws; a bad file starts from scratch. |
| `discovery/html.ts` | HTML to text, and same-host link extraction. |
| `discovery/parsers/` | One parser per source kind: `listing.ts` (links to follow), `page.ts`, `rss.ts`, `ical.ts`, `telegram.ts`. |
| `discovery/cecam-client.ts` | Reads CECAM's program from the JSON API its page renders from. |
| `discovery/mailbox-client.ts` | Read-only IMAP: plaintext bodies from one folder, deduplicated on `Message-ID`. |
| `discovery/keyword-topics.ts` | Topic slugs from keyword matches against `data/topics.yaml`, so a typed feed needs no LLM call. |
| `discovery/extract-client.ts` | The extraction LLM call (chat completions, JSON output, no tools). Page text goes in as delimited data. |
| `discovery/draft.ts` | Turns an extraction into a schema-shaped event: id slug (with Cyrillic transliteration), file path, YAML. |
| `discovery/orchestrator.ts` | Classifies candidates and opens one pull request each, with the candidate-controlled text rendered inert in the PR body. |
| `discovery/github-client.ts` | The GitHub REST calls the orchestrator needs: branches, files, pull requests, labels, issues. |
| `discovery/auto-approve.ts` | Labels open discovery PRs `high-confidence` when confidence ≥ 0.90 and CI passed. Never merges. |
| `types.ts` | The shared vocabulary: event types, formats, deadline types, statuses, and the loaded-event shape. |
| `filter.ts` | Filter state and matching. Parses and serialises the query string, and decides whether a row matches. Shared verbatim between the server render and the browser so both agree. |
| `regions.ts` | Country-to-region mapping and country display names. |
| `ical.ts` | iCalendar construction: text escaping, 75-octet line folding, date formatting, calendar assembly. RFC compliance lives here. |
| `orbital.ts` | Monte-Carlo point cloud of a real hydrogenic 3d(z²) orbital — the masthead plate. The dots are samples from ∣ψ∣² and their two colours are the two signs of ψ. Runs at build time only. |

## `src/pages/` — routes and outputs

One file per URL. Pages stay thin; they compose `src/lib/`.

| Path | Route |
| --- | --- |
| `index.astro` | `/` — upcoming events with filters. |
| `events/[id].astro` | `/events/<id>` — one event, with its related events. |
| `topics.astro` | `/topics/` — every topic, with its upcoming count. |
| `topics/[slug].astro` | `/topics/<slug>/` — upcoming and past events in one topic, with that topic's feeds. |
| `topics/[slug].ics.ts` | `/topics/<slug>.ics` — that topic's upcoming events as a calendar. |
| `topics/[slug].xml.ts` | `/topics/<slug>.xml` — Atom feed of that topic's newly added events. |
| `series/[slug].astro` | `/series/<slug>/` — every edition of a recurring event. Built only for a series with two or more listed editions. |
| `graph.astro` | `/graph/` — the event map: similar events drawn close together. |
| `sources.astro` | `/sources/` — the public list of what the discovery agent reads. |
| `donate.astro` | `/donate/` — what running the site costs, and how to help. |
| `archive.astro` | `/archive` — past events. |
| `about.astro` | `/about` — what this is, plus the curation policy. |
| `submit.astro` | `/submit` — how to add or correct an event. |
| `404.astro` | Not-found page. |
| `events.ics.ts` | `/events.ics` — all upcoming events as all-day calendar entries. |
| `deadlines.ics.ts` | `/deadlines.ics` — upcoming deadlines as calendar entries. |
| `feed.xml.ts` | `/feed.xml` — Atom feed of newly added events, newest first. |
| `events.json.ts` | `/events.json` — the full public dataset with a `generated_at` stamp. |
| `sitemap.xml.ts` | `/sitemap.xml`. |
| `robots.txt.ts` | `/robots.txt`. |

## `src/components/` and `src/layouts/`

| Path | What it is |
| --- | --- |
| `layouts/Base.astro` | The page shell: masthead, footer, metadata, global stylesheet. |
| `components/EventRow.astro` | One event in a list, with its dates, place, topics and staleness note. |
| `components/DeadlineList.astro` | An event's deadlines. |
| `components/OrbitalField.astro` | Renders the orbital plate as inline SVG at build time — inline so the dots can follow the theme tokens, which an external image could not. |
| `components/PageActions.astro` | The row of per-page actions (subscribe, export, submit). |

## `src/scripts/` — the browser's share

Progressive enhancement only. The site must be readable and usable with
JavaScript disabled; nothing here is load-bearing.

| Path | What it does |
| --- | --- |
| `filters.ts` | Filters the list client-side and keeps the URL in step. Server-rendered results are the fallback. |
| `countdown.ts` | Appends a relative phrase ("closes in 12 days") beside the rendered date, so a static build never serves a stale countdown. Leaves the `<time>` element's machine-readable text alone. |
| `graph.ts` | Brings the event map to life: drag, neighbour highlighting, pan and zoom. The static SVG works without it. |
| `theme.ts` | Reveals and drives the theme toggle. Only unhides the control when it can work, so it never appears uselessly. A small inline script in `<head>` applies a stored choice before first paint. |

## `src/styles/`

| Path | What it is |
| --- | --- |
| `global.css` | The whole stylesheet: colour tokens for both themes, typography, layout. The light and dark palettes are each declared twice — once under `prefers-color-scheme` and once under `[data-theme]` — because CSS cannot share a block between a media query and an attribute selector. A test asserts the two copies stay identical. |

## `tests/`

Vitest. Run with `npm test`.

| Path | What it covers |
| --- | --- |
| `tests/lib/*.test.ts` | One file per `src/lib/` module: dates, events, filter, ical, orbital, regions, validation, and the semantic rules. |
| `tests/schema/schema.test.ts` | The JSON Schema itself. |
| `tests/endpoints/` | The generated outputs: both `.ics` files parsed with a real iCalendar parser, plus the feed, JSON and sitemap. |
| `tests/pages/links.test.ts` | Internal links resolve. |
| `tests/scripts/filters.test.ts` | Client-side filtering behaviour. |
| `tests/styles/contrast.test.ts` | Every WCAG contrast pair in both themes, and that the duplicated palettes agree. |
| `tests/cli/validate-guard.test.ts` | The validator CLI exits non-zero on bad data. |
| `tests/discovery/*.test.ts` | The discovery agent, one file per module: sources, fetching, parsers, extraction, drafting, classification, the orchestrator and the CLIs. Every LLM, GitHub and IMAP call is stubbed; CI never calls a real API. |
| `tests/discovery/fixtures/candidates/` | Candidate events covering a clean add, each mechanical skip reason, and an adversarial prompt-injection attempt. |
| `tests/smoke.test.ts` | `site.config.ts` sanity (Vitest, not a browser). |
| `tests/e2e/*.spec.ts` | Playwright, against a production build: `smoke.spec.ts` (the home page loads, choosing a topic reduces the list, the URL updates), `graph.spec.ts` (the event map) and `related.spec.ts` (related events on an event page). Run with `npm run test:e2e`; not part of `npm test`. |
| `tests/fixtures/valid/` | Events that must pass, covering the minimal, full and cancelled shapes. |
| `tests/fixtures/invalid/` | One file per rule that must fail, named for the rule it breaks. Add a file here whenever you add a rule. |
| `tests/fixtures/warnings/` | Events that pass but should warn, such as a stale `last_verified`. |
| `tests/fixtures/cli/validate.ts` | Helper for driving the validator in tests. |

## `docs/`

| Path | What it is |
| --- | --- |
| `docs/data-schema.md` | Every event field explained, for contributors. |
| `docs/curation-policy.md` | What gets listed, what does not, and how the blocklist works. |
| `docs/discovery-agent.md` | The discovery agent: pipeline, security model, configuration, sources and deployment. Implemented and running. Read it with `data/sources.yaml`. |
| `docs/decisions.md` | Running log of decisions and their reasons, newest last. Every deviation from the brief is recorded here. |
| `docs/superpowers/specs/` | Design specs, one per project phase. |
| `docs/superpowers/plans/` | Implementation plans matching those specs. |

## `.github/`

| Path | What it is |
| --- | --- |
| `.github/workflows/ci.yml` | Lint, typecheck, validate (event data and `data/sources.yaml`), test, build and the Playwright e2e test on every push and pull request; a pull request also gets a warning-only link check of the event files it touches. Duplicate detection (same `url`, or same title and start date) is a semantic rule inside `npm run validate`, not a separate job. |
| `.github/workflows/links.yml` | Weekly cron (and manual `workflow_dispatch`) that fetches every `url`/`source_url` in `data/events/` and files or updates one tracking issue listing the dead ones. Never fails the workflow. |
| `.github/workflows/rebuild.yml` | Daily cron (and manual `workflow_dispatch`) that POSTs to the Cloudflare deploy hook in the `CF_DEPLOY_HOOK` secret, so events roll from upcoming to past without a commit. Skips with a log message if the secret isn't set. |
| `.github/pull_request_template.md` | The checklist a pull request must satisfy. |
| `.github/ISSUE_TEMPLATE/event-submission.yml` | Issue form for suggesting an event with no GitHub/coding experience — route 2 in `CONTRIBUTING.md`. |
| `.github/ISSUE_TEMPLATE/correction.yml` | Issue form for reporting a wrong field on a listed event. |

## Not in the repository

- `node_modules/`, `dist/`, `.astro/` — installed or generated. Never committed.
- `.superpowers/` — local agent working notes (task briefs, reports, review
  diffs). Gitignored; not project documentation.
