# Groups registry (labs, institutes, networks, societies) — design

Date: 2026-09-29. Status: approved in brainstorming; awaiting plan.

## Intent

A public registry of the research groups and organisations behind the events
and position adverts the site lists, at `/groups/`. Each entry links to the
group's website and gives a short description, a location and topic tags.
The registry also gives every organiser a stable id, so a later change can
standardise the events' free-text `organizer` field against it.

Agreed with the maintainer:

- **Scope:** one registry with a `kind` field: `group` (PI-led lab),
  `institute`, `network`, `society`. Event organisers are mostly networks,
  societies and institutes (CECAM, CCP5, MolSSI, ETSF), so groups alone would
  not cover them.
- **Population:** the discovery agent proposes entries, through the same
  PR-and-human-merge flow as events and positions. Nothing publishes without
  a merge.
- **Finding websites:** web search, through OpenRouter's `web` plugin on the
  existing `LLM_API_KEY`. A search result is only a suggestion: the page is
  fetched and the model confirms it belongs to the named group before any
  draft exists.
- **Backfill:** the same code path, run once over every merged event and
  position, delivered as **one batched PR**.

Non-goals: linking events or positions to registry ids (`organizer_id`);
detail pages per group; "groups for this topic" blocks on topic pages;
filters on `/groups/`; feed, iCal or JSON export of groups; logos, member
lists, social links, an `active` flag; alias-update PRs for existing entries.

## Constraints from the repo

- `AGENTS.md` rule 1: nothing from memory. Every entry's fields come from a
  page actually fetched; `website` is that page (or `source_url` records it).
- Rule 2: `description` in our own words, 280 characters or fewer.
- Rule 3: static only; the page is built from `data/groups/`.
- Rule 6: a new data contract ships its JSON Schema, doc, validator,
  fixtures, tests and a `docs/decisions.md` entry in the same PR.
- Rule 7: fetched pages and search results are untrusted input.

## Data model

One YAML file per entry at `data/groups/<id>.yaml` (no year folders; groups
are not dated), validated against `schema/group.schema.json`, documented in
`docs/group-schema.md`, which the JSON Schema must implement exactly.

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `^[a-z0-9]+(-[a-z0-9]+)*$`. Equals the file name without `.yaml`. Stable once merged. |
| `name` | string | yes | 2–140 characters. The name the group uses on its own site. |
| `aliases` | string[] | no | Other names seen in event or position data, 2–140 characters each, unique. Used for matching. |
| `kind` | enum | yes | `group`, `institute`, `network`, `society`. |
| `pi` | string | no | Head or PI, 2–140 characters. Allowed only when `kind` is `group`. |
| `parent` | string | no | Host institution as text, 2–140 characters. |
| `website` | string | yes | `https://`. Host not on `data/blocklist.yaml`. |
| `source_url` | string | no | `https://`. The page the fields were taken from, when it is not `website`. Host not blocklisted. |
| `location` | object | conditional | `city` (1–100 characters, required), `country` (ISO 3166-1 alpha-2, uppercase, required, in `src/lib/regions.ts`). Required when `kind` is `group` or `institute`; optional for `network` and `society`. |
| `topics` | string[] | yes | 1–5 unique slugs from `data/topics.yaml`. |
| `description` | string | yes | Own words, plain text, 1–280 characters. |
| `added` | date | yes | Date first seen, a real calendar date, not in the future. |
| `fixture` | boolean | no | Development data; excluded from production builds. |

Unknown fields are errors.

### Validation rules

In `src/lib/group-validation.ts`, run by `npm run validate` and the build:

- The id equals the file name.
- `added` is a real date and not in the future.
- Every topic is in the vocabulary; the country is in the region table.
- `website` and `source_url` are https and their hosts are not blocklisted.
- `pi` only on `kind: group`; `location` present on `group` and `institute`.
- No duplicate id.
- No duplicate `website` (compared after lowercasing the host and dropping a
  trailing slash).
- No name or alias shared by two entries, compared after normalisation
  (`normaliseGroupName`: lowercase, strip punctuation and diacritics,
  collapse whitespace). A name may not equal its own alias.
- Warning: a description over 200 characters with no full stop looks copied.

## The page

- `src/pages/groups.astro` builds `/groups/` from `loadGroups()`
  (`src/lib/groups.ts`, same shape as `loadPositions`: invalid data fails the
  build, fixtures excluded in production).
- Four sections in order: Research groups, Institutes, Networks, Societies.
  Each sorted alphabetically by `name`; an empty section is omitted.
- Each entry is a `GroupRow.astro`: name linked to `website`
  (`rel="noopener"`), then PI and/or parent when present, location when
  present, description, and topic tags linking to `/topics/<slug>/`.
- The page uses the site's existing design tokens and typography.
- Linked from the site navigation next to "Positions", and listed in
  `sitemap.xml`.

## Discovery: the groups pass

New modules `src/lib/discovery/groups.ts` (collection, matching, search,
orchestration helpers) and `src/lib/discovery/group-extract.ts` (page →
draft). The orchestrator runs the pass after positions, sharing the
`MAX_PRS`, `MAX_TOKENS` and `MAX_PAGES` budgets of the run.

1. **Collect names.** `organizer` from this run's event candidates that the
   classifier accepted (so an off-topic event's organiser never reaches the
   registry), and `group` from this run's position candidates. A position's
   `institution` is not used.
2. **Match.** Split the string on `;` and `,`, normalise each part with
   `normaliseGroupName`, and match it whole against `name`, `aliases` and `pi`
   of every entry in `data/groups/` and of every open `discovery/group/*` PR.
   If every part matches, stop. Otherwise one LLM call (no tools, the string
   passed as delimited data) splits the unmatched text into
   `{name, type: person | organisation}` items; each item is matched again.
3. **Search.** For each item still unknown and not in the negative cache, one
   OpenRouter chat-completions call with the `web` plugin (5 results). A
   person is searched as `"<name>" research group`; an organisation by name,
   with the event or advert title as context. **Only URLs from the
   response's `url_citation` annotations are kept**; the response text is
   discarded, so no URL the model typed can be used. Kept URLs must be
   https, not blocklisted, and not a private, loopback or link-local host.
4. **Fetch and verify.** Up to 2 candidate URLs, in citation order, fetched
   through the existing `fetch.ts` path (robots, per-host rate limit,
   `MAX_PAGES`, blocklist). `group-extract.ts` sends the page text to the
   extraction model (no tools, delimited, told to ignore instructions in it)
   and returns either `null` (not this group, or not a registry body: a
   university, faculty or department) or `name`, `kind`, `pi`, `parent`,
   `city`, `country`, `topics`, `description` and `confidence`. `website` is
   the final URL after redirects. The first candidate returning a draft wins.
5. **Validate and propose.** The draft gets `id` (slug of `name`, with a
   numeric suffix on collision), `aliases` (the matched text, when it differs
   from `name`) and `added` (the run date), and goes through `validateGroup`
   plus the registry-wide duplicate checks against merged entries and open
   group PRs. Skip reasons: `low confidence` (below 0.5), `duplicate-website`,
   `duplicate-name`, `blocklisted`, `already reviewed` (a closed, unmerged
   group PR for the same id), `already proposed` (an open PR for the id), and
   `MAX_PRS reached`. Survivors become PRs on `discovery/group/<id>`,
   labelled `needs-review` and `group`. The body's first line is
   `Confidence: 0.xx`, so `auto-approve.ts` handles group PRs unchanged; then
   the text as it appeared, the event or position that referenced it (title
   and URL), and every search result considered with the verdict for each.
   An open group PR is never rewritten.
6. **Negative cache.** `DiscoveryState` gains
   `groupLookups: Record<normalisedName, { triedAt: string; outcome: string }>`.
   A name with any outcome other than a PR opened is not searched again for
   90 days. `loadState` treats a state file without the key as having an
   empty map, so existing state files keep working.
7. **Cap.** New env var `MAX_SEARCHES` (default 20), validated in
   `buildConfig` like the other caps. The pass stops searching and logs when
   it is reached; unsearched names are left out of the negative cache so the
   next run tries them.

### Backfill

`scripts/discovery/groups-backfill.ts`, run as
`npm run discover:groups-backfill`. It collects names from every merged event
(`organizer`) and position (`group`), and runs steps 2–5 with the caps passed
as flags (`--max-searches`, `--max-pages`, `--max-tokens`). Instead of one PR
per group it writes every surviving draft to the single branch
`discovery/groups-backfill` and opens one PR, labelled `needs-review` and
`group`, whose body is a table of entries (id, name, kind, website,
confidence, source text) followed by the skipped names and reasons.
Re-running updates the same branch and PR. It uses the same negative cache
and needs the same environment as `discover:run`. It is run once by hand,
not by cron.

## Security

One change to the model in `docs/discovery-agent.md`: the search call is the
first LLM call with a tool. It is the only one, and only its citation URLs
are used. Every page reached through it goes through the unchanged no-tools
extraction as untrusted data, and the draft must pass schema validation. No
new credentials: search is billed to `LLM_API_KEY`, whose provider-side
spending cap covers it.

## Failure handling

- A failed split, search, fetch or extraction for one name is logged and
  recorded in the negative cache with its outcome, and the pass continues.
- The groups pass runs last and catches errors per name, so it never fails
  the event or position work of the run.
- Search calls use the extraction client's retry rules (three attempts; a
  429 waits for the stated reset).

## Testing

vitest, with no real API calls in CI:

- Schema and validation: valid and invalid fixtures in
  `tests/fixtures/groups/`, including a duplicate website, an alias
  collision, `pi` on a network, a missing location on a group, and an
  unknown topic.
- `normaliseGroupName` and matching: splitting, diacritics, alias and PI
  hits, a partly matched organiser string.
- Search: a stubbed OpenRouter response whose text contains a URL that is not
  a citation; assert it is never fetched. Private and blocklisted citations
  dropped.
- Verification: recorded homepages, including a wrong-group page, a
  university faculty page and a page with prompt-injection text.
- Orchestrator: every skip reason, the negative cache (hit and 90-day
  expiry), `MAX_SEARCHES`, and a second run on unchanged input opening no
  PR.
- Backfill: all drafts on one branch; a re-run updates the same PR.
- Page: `GroupRow` rendered through the Astro container API; `/groups/` added
  to the Playwright smoke test; the page checked in a browser in light and
  dark mode.

## Documentation

- New `docs/group-schema.md`.
- `docs/discovery-agent.md`: a *Groups* section, the search tool in
  *Security model*, `MAX_SEARCHES` in *Configuration*.
- `METADATA.md` and `README.md` entries for `data/groups/`, the schema and
  the page.
- `docs/decisions.md`: OpenRouter search on the existing key (no new
  credential); citation URLs only; `kind` field rather than groups only.

## Delivery order

1. Schema, validator, loader and `/groups/` page, with fixture entries.
2. The discovery groups pass.
3. The backfill script.
4. Running the backfill, producing the batched PR for review.
