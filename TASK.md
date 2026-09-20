# TASK: Build v1 of the computational chemistry events site

Written: 2026-09-20 · Working name: `<SITE_NAME>` (placeholder, lives only in `site.config.ts`)

## 1. Goal

Build and ship v1 of a **community-maintained static website** that aggregates conferences, workshops, schools and similar events in computational and theoretical chemistry (electronic structure, molecular simulation, ML for chemistry and materials, computational materials science, computational drug design).

Users are researchers, especially PhD students and postdocs, who want to find events and see deadlines in one place, filter them, and subscribe via calendar or feed.

Success looks like this: a visitor can filter upcoming events by topic, region, format and deadline, open an event, add it or its deadlines to their calendar, and report a suspicious listing. A contributor can add an event with one small pull request. The maintainer pays almost nothing to run it.

## 2. Read first

1. `README.md`: what the project is.
2. `AGENTS.md`: the rules you must follow throughout. Read it fully.
3. `docs/data-schema.md`: the event data model. This is the contract.
4. `docs/curation-policy.md`: what may be listed, and how.
5. `docs/discovery-agent.md`: **out of scope for this task** (see section 7), but skim it so your data model and CI don't block it.

## 3. Scope

**In scope (this task):** phases 0-4 below.

**Out of scope:** any server or backend code, databases, user accounts, ratings or reviews, paid listings or job board, analytics or tracking, the discovery agent (a separate follow-up), translations.

## 4. Decisions already made (do not relitigate)

- **Hosting:** Cloudflare Pages, connected to a public GitHub repo. Output is static files only.
- **Source of truth:** YAML files in `data/events/`. No database.
- **Stack:** Astro (static output), TypeScript (strict), current Node LTS. If you deviate from Astro, record the reason in `docs/decisions.md` first.
- **Filtering:** client-side, vanilla TypeScript, no UI framework. State lives in the URL query string so filtered views are shareable. The lists must remain readable with JavaScript disabled.
- **Reports:** an external form service (Tally, Formspree or similar). The site only renders a link with the event ID prefilled. No backend.
- **Ratings:** not in v1.
- **Privacy:** no cookies, no trackers, no third-party scripts, no external fonts. System font stack.
- **Language:** English only.

## 5. Phases

Work phase by phase. One branch and one PR per phase (`feat/phase-N-<slug>`). Do not start a phase until the previous one meets its acceptance criteria.

### Phase 0: Scaffold

- Initialise the Astro project at the repo root, TypeScript strict, ESLint, Prettier, Vitest.
- Create `site.config.ts` with: site name, tagline, production URL, contact email, GitHub repo URL, `reportForm` (`url`, plus the query-parameter names for event ID and event URL), `submissionFormUrl`. Use clearly marked placeholder values. Nothing else in the codebase may hard-code these.
- npm scripts: `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `validate`.
- `.github/workflows/ci.yml`: on pull request and push to `main`, run install, lint, typecheck, validate, test, build. Cache dependencies.
- Create `docs/decisions.md` (a short running log: date, decision, reason).

**Acceptance:** on a clean checkout, `npm ci && npm run lint && npm run typecheck && npm run validate && npm test && npm run build` passes, and CI is green.

### Phase 1: Data layer

- `schema/event.schema.json` (JSON Schema 2020-12) implementing `docs/data-schema.md` exactly.
- `data/topics.yaml` (controlled vocabulary, from the schema doc), `data/blocklist.yaml` (empty, with a header comment explaining the format from `docs/curation-policy.md`).
- `scripts/validate.ts`: schema validation **plus** the semantic checks listed in `docs/data-schema.md`. Output must name the file path and the field for every problem, and exit non-zero on errors. Warnings do not fail the run.
- `src/lib/events.ts`: the single loader used by pages and feeds. It parses YAML, runs validation at build time (a build must fail on invalid data), drops `fixture: true` events in production builds, sorts, derives status (`upcoming`, `ongoing`, `past`) from the build date in UTC, and provides `regionOf(country)`.
- Tests: `tests/fixtures/valid/` and `tests/fixtures/invalid/`. Each invalid fixture has a comment naming the expected error, and a test asserts it is reported.
- **Seed data:**
  - Add 3 clearly fake `fixture: true` events (use `example.org` URLs) for development.
  - If you have web access, also add 15-30 **real** upcoming events (start date after 2026-09-20) from official organiser pages. Every real event needs `source_url` on the organiser's own site, and `last_verified` set to the date you actually checked. Write descriptions in your own words (see AGENTS.md).
  - If you have no web access, ship the fixtures only and say so in your final report. **Never invent or "recall" real events from memory.**

**Acceptance:** validator passes on valid data, reports every expected error on the invalid fixtures, and unit tests cover the loader and `regionOf`.

### Phase 2: Pages

Routes:

- `/`: upcoming and ongoing events, sorted by start date. Filters: free-text (title, organiser, city), topics (multi-select), region and country, format, type, date range, and a "has open deadline" toggle. Show the result count in an `aria-live` region and a "Clear filters" control. Filter state is written to and read from the URL.
- `/events/<id>/`: full details, deadlines table (show the timezone; `AoE` means Anywhere on Earth), "Report this event" link (built from `site.config.ts` with the event ID and URL prefilled), "Suggest a correction" link (prefilled GitHub issue URL), last-verified date, and schema.org `Event` JSON-LD.
- `/deadlines/`: upcoming deadlines across all events, soonest first, with the same topic filter.
- `/archive/`: past events grouped by year.
- `/about/`, `/submit/` (the three ways to add an event, from `CONTRIBUTING.md`), `/policy/` (renders `docs/curation-policy.md`), `404`.
- Also produce `sitemap.xml` and `robots.txt`, canonical URLs and OpenGraph tags.

Behaviour details:

- Deadline countdowns ("closes in 12 days") are computed **client-side** from ISO dates so they don't go stale between builds. The server-rendered HTML shows the plain date.
- Events not verified within 90 days before their start date show a subtle "dates last verified on X, check the official page" note.
- Cancelled and postponed events stay listed, visibly marked.

Non-functional requirements:

- Responsive down to 360 px, keyboard navigable, WCAG AA contrast, respects `prefers-color-scheme` and `prefers-reduced-motion`.
- Under 30 kB of gzipped JavaScript on the home page.
- Lighthouse (mobile) of 95 or higher for performance, accessibility, best practices and SEO on `/` and one event page.

**Acceptance:** all routes build, the home page filters work and update the URL, the site is usable with JS disabled, and Lighthouse targets are met. Paste the scores into the PR.

### Phase 3: Feeds and exports

- `/events.ics`: all upcoming events as all-day calendar events.
- `/deadlines.ics`: all upcoming deadlines as all-day calendar events titled `[Abstract deadline] <event title>` and so on.
- `/feed.xml`: Atom feed of newly added events (use the `added` field), newest first.
- `/events.json`: the full public dataset with stable field names and a `generated_at` timestamp, documented in `docs/data-schema.md`.

iCalendar requirements: CRLF line endings; lines folded at 75 octets; escaped commas, semicolons and newlines in text; all-day events use `DTSTART;VALUE=DATE`, and **`DTEND` is exclusive** (end date + 1 day); stable UIDs (`<id>@<site-domain>`, and `<id>-<deadline-type>@<site-domain>` for deadlines); `STATUS:CANCELLED` for cancelled events; `X-WR-CALNAME` set. For `AoE` deadlines, use that date and say "AoE" in the description.

**Acceptance:** tests parse both `.ics` outputs with an iCalendar parser library and assert event counts, dates (including the exclusive `DTEND`) and UIDs. Feed and JSON outputs validate against their specs or schema.

### Phase 4: Quality gates and contributor experience

- PR checks: validation, duplicate detection (same `url`, or same title and start date), and a link check on changed files (warning only).
- `.github/workflows/links.yml`: weekly link check of every `url` and `source_url`. It creates or updates a single tracking issue listing dead links, and never fails builds.
- `.github/workflows/rebuild.yml`: daily cron that POSTs to a Cloudflare Pages deploy hook stored in the secret `CF_DEPLOY_HOOK`, so events move from upcoming to past without a commit. If the secret is missing, skip with a clear log message.
- `.github/ISSUE_TEMPLATE/event-submission.yml` and `correction.yml` (issue forms), plus the existing `.github/pull_request_template.md`.
- One Playwright smoke test: the home page loads, choosing a topic reduces the list, and the URL updates.
- Update `README.md` with the real commands, and finish `docs/decisions.md`.

**Acceptance:** CI, link-check and rebuild workflows run (rebuild may be skipped without the secret). A new contributor can follow `CONTRIBUTING.md` from scratch and open a valid PR.

## 6. Human-only steps (do not attempt; list any that block you)

1. Create the GitHub repository and set it public.
2. Register the domain and connect Cloudflare Pages (build command `npm run build`, output directory `dist`, Node version pinned to match `.nvmrc`).
3. Create the report form and the submission form, then give you the URLs and parameter names.
4. Create the Cloudflare deploy hook and add it as the `CF_DEPLOY_HOOK` repo secret.
5. Choose licences (suggestion: MIT for code, CC0 or CC BY 4.0 for data). Until decided, leave `LICENSE` files out and note it in your report.
6. Decide the final site name and domain.

## 7. Follow-up (not this task)

**Phase 5, discovery agent.** A scheduled agent on the maintainer's VDS finds candidate events, extracts them into the schema and opens pull requests for human review. It is specified in `docs/discovery-agent.md` and will be a separate task. Your only obligations now: keep the schema and validator usable as a library (`import { validateEvent }`) and keep `data/` free of anything an automated PR would trip over.

## 8. Definition of done

- All acceptance criteria above are met and CI is green.
- No secrets, tokens or personal data in the repo.
- Every deviation from this brief is in `docs/decisions.md`.
- The README's commands actually work from a clean checkout.

## 9. Final report (post this when finished)

1. What was built, per phase, with links to the PRs.
2. Lighthouse scores and the JS size of the home page.
3. Every assumption you made and every deviation, with the reason.
4. Anything you could not do (for example, no web access for seed data, human-only steps still pending).
5. Suggested next steps.
