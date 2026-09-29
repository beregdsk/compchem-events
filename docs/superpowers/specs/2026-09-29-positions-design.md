# Positions page (PhD, postdoc, permanent academic jobs) — design

Date: 2026-09-29. Status: approved in conversation; awaiting review of this
written spec before planning.

## Intent

The sources the discovery agent already watches (mailing lists, RSS feeds,
Telegram channels) also carry job and PhD adverts, which the event extractor
currently throws away. This adds them to the site as a separate listing at
`/positions/`, so early-career and academic readers find openings where they
already look for events.

Agreed with the maintainer:

- **Scope:** PhD, postdoc and permanent academic positions (research
  scientist, lecturer, faculty). No industry jobs: recruiter-heavy and hard to
  screen under the curation policy.
- **Discovery:** automatic, from the existing sources, through the same
  PR-and-human-merge flow as events. Nothing publishes without a merge.
- **Staleness:** an advert without a deadline is still listed. It is marked
  stale 45 days after it was added and archived at 90 days. An advert with a
  deadline is archived the day after its deadline.
- **Routing:** a keyword gate sends likely job posts to a separate position
  extractor; anything it rejects falls through to the event extractor, which
  is otherwise untouched.

Non-goals: industry jobs; a detail page per position; salary, contract length
or start date fields; filters on the positions page; an Atom feed, iCal or
JSON export for positions; a manual "filled" flag; position extraction from
listing-mode or event-only sources (CECAM API, listing pages, iCal, CCL's
inline listing).

## Constraints from the repo

- `AGENTS.md` rule 1: nothing from memory; every position needs an official
  `url` and a real `last_verified`.
- Rule 2: `description` in our own words, 280 characters or fewer.
- Rule 3: static only; status is derived at build time. `rebuild.yml` already
  rebuilds daily, so open/stale/archived move on schedule.
- Rule 6: a new data contract ships its JSON Schema, doc, validator, fixtures,
  tests and a `docs/decisions.md` entry in the same PR.
- Rule 7: adverts are untrusted text, exactly like event pages.

## Data model

One YAML file per position at `data/positions/<added-year>/<id>.yaml`,
validated against `schema/position.schema.json`, documented in
`docs/position-schema.md`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `^[a-z0-9]+(-[a-z0-9]+)*-\d{4}$`, ending with the year of `added`. Equals the file name without `.yaml`. |
| `title` | string | yes | 5–140 characters. |
| `level` | enum | yes | `phd`, `postdoc`, `permanent`. |
| `institution` | string | yes | 2–140 characters. |
| `group` | string | no | Research group or PI, 2–140 characters. |
| `location` | object | yes | `city` (string, required), `country` (ISO 3166-1 alpha-2, uppercase, required). |
| `url` | string | yes | Official advert, `https://`. Host not on `data/blocklist.yaml`. |
| `source_url` | string | no | Where it was found, if different from `url`. `https://`. |
| `deadline` | date | no | Application deadline, `YYYY-MM-DD`. Omitted when the advert states none. |
| `topics` | string[] | yes | 1–5 unique slugs from `data/topics.yaml`. |
| `description` | string | yes | Own words, plain text, 280 characters or fewer. |
| `added` | date | yes | Date first seen. Not in the future. |
| `last_verified` | date | yes | Date someone last checked the advert. Not in the future. |
| `fixture` | boolean | no | Development data; excluded from production builds. |

Unknown fields are errors, as for events. To close a position early, set
`deadline` to a past date.

### Derived status

Computed by `src/lib/positions.ts` for a given `today` (UTC calendar dates,
never local time), never stored:

- **open** — `deadline >= today`, or no deadline and `today - added < 45` days.
- **stale** — no deadline and `45 <= today - added < 90` days.
- **archived** — `deadline < today`, or no deadline and `today - added >= 90`.

The two thresholds are named constants in `positions.ts`.

## Discovery

### Pipeline (`src/lib/discovery/pipeline.ts`)

Only items processed in single mode (RSS items, Telegram posts, mailbox
messages) are eligible. After the existing `looksRelevant` topic check:

1. `looksLikePosition(text)` — a case-insensitive phrase match (e.g. "PhD
   position", "PhD studentship", "postdoc", "postdoctoral", "vacancy", "we are
   hiring", "research fellow", "lecturer", "faculty position", "apply by").
   The list lives in one exported constant.
2. On a match, `extractPosition` (new, in `extract-client.ts`) runs with its
   own JSON schema and prompt: same untrusted-text framing, same rules — never
   invent a URL or a deadline (`null` when not stated), English own-words
   description, ISO country codes, topics from the vocabulary, a `confidence`.
3. If it returns a position: build a draft (topics fall back to
   `keywordTopics`), validate it with the position validator, drop it if its
   deadline has passed, otherwise add it to the run's position candidates.
   Unlike events, `url` does **not** fall back to the fetched item's URL: a
   position whose text states no advert URL is dropped (logged), because a
   mailing-list message or Telegram post is not an official advert.
4. If it returns nothing, the item continues to `extractEvent` as today.

`PipelineResult` gains `positions: RawPosition[]` (with the extractor's
confidence carried alongside). Page state, per-source page caps and the token
cap are shared with events; position extraction counts toward `maxTokens`. An
extraction error follows the existing rule: logged, not rethrown, page state
not committed.

### Orchestrator (`src/lib/discovery/orchestrator.ts`)

Positions are processed in their own loop after events, sharing `maxPrs` and
`maxTokens`:

- **Mechanical skip, no LLM:** duplicate `url`; duplicate normalised title plus
  institution (`normaliseTitle` from `validation.ts`); blocklisted host.
  Checked against positions on main and those accepted earlier in the same run.
- **Confidence floor:** skip below `ADD_THRESHOLD` (0.5).
- **PR:** branch `discovery/position/<id>`, file `draftPositionFilePath`,
  labels `needs-review` and `position`, and a body in the existing format
  that records the confidence line `auto-approve.ts` already parses. The
  branch-status handling (update open PR, never reopen a reviewed one, resume
  a branch without a PR) is shared with events, not duplicated.

The event classifier (`classifyCandidate`) is not used: its criteria
(programme, registration cost) do not apply to adverts, and a human reviews
every PR.

## Pages

### `/positions/` (`src/pages/positions/index.astro`)

- Heading, then a short note: positions are gathered from the same sources as
  events, reviewed before publishing; always check the official advert.
- **Open**: positions with a deadline, soonest first; then those without,
  newest `added` first.
- **May already be filled**: stale positions, newest first, each labelled
  "posted N days ago".
- Row: level tag (PhD / Postdoc / Permanent), title linking to `url`
  (the official advert), institution and group, city and country, deadline or
  "no deadline", topic tags. Styled from the existing event-list rules.
- Empty state: "No open positions right now."
- Link to the archive.

### `/positions/archive/` (`src/pages/positions/archive.astro`)

Archived positions grouped by year of `added`, newest first, plain rows.

### Wiring

- "Positions" in the footer's About column (`Base.astro`) and in the home
  page's `PageActions`.
- Both routes in `sitemap.xml.ts`.
- `METADATA.md` lines for every new file.

### Loader (`src/lib/positions.ts`)

`loadPositions(options)` reads `data/positions/**`, drops fixtures in
production (same rule as `loadEvents`), and returns `LoadedPosition`
(`RawPosition` plus `status_derived` and `age_days`). Helpers:
`openPositions`, `stalePositions`, `archivedPositions`, each already sorted
as above. Invalid position data fails `npm run validate` and the build.

## Validation

`src/lib/validation.ts` gains `validatePosition` and the collection check
covers `data/positions/`, reusing the event checks that apply (id/file name,
https, blocklist, topic vocabulary, date sanity, duplicate ids). No warnings
beyond the shared copied-description check: a position leaves the page within
90 days unless it has a deadline, so a stale-verification warning adds little.

## Testing

- **Unit, `positions.ts`:** status at each boundary — deadline today (open),
  deadline yesterday (archived); no deadline at 44 (open), 45 (stale),
  89 (stale), 90 (archived) days; ordering of each list; fixtures excluded
  in production.
- **Unit, validation:** rejects unknown `level`, `http://` url, off-vocabulary
  topic, id/file-name mismatch, future `last_verified`, unknown field.
- **Discovery:** `looksLikePosition` on recorded job and event posts;
  `extractPosition` with a stubbed LLM (canned JSON), including a
  prompt-injection fixture and an invented-deadline case; pipeline routes a
  job post to positions, leaves an event post unchanged, falls back to
  events when the gate matches but no position is found, and drops a position
  with no stated advert URL; orchestrator
  duplicate skips, confidence floor, branch name and labels. CI never calls a
  real LLM.
- **E2E (Playwright):** `/positions/` shows fixture rows in open-then-stale
  order with working links; the archive renders; both work without
  JavaScript.

## Docs

In the same PR: `docs/position-schema.md`; a `docs/decisions.md` entry
(scope B, 45/90-day rule, keyword gate with fallback, no LLM classifier for
positions); `docs/discovery-agent.md` (position routing and PRs);
`docs/curation-policy.md` gains a "Positions" section — academic PhD, postdoc
and permanent roles in computational or theoretical chemistry; no recruiters,
agencies or industry roles; the advert must be on the institution's own site
or an official job portal.
