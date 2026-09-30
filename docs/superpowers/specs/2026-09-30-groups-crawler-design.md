# Groups crawler — design

Date: 2026-09-30. Status: sections 1 (components, data flow) and 2 (crawl
rules, classification) agreed in conversation 2026-09-30. Section 3
(budgets, failure handling, testing) is new in this document and awaits
the maintainer's review with the rest of it.

## Intent

The maintainer wants the registry to cover, ideally, every computational
chemistry group. Today groups arrive only from event organisers,
position adverts and three hand-picked listing pages, one web search per
name. That cannot reach thousands of groups. This design adds a crawler
that finds the pages *listing* many groups (a department's "research
groups" page, a network's member list, a curated directory) and feeds
the group links on them into the existing resolver, which verifies each
group's homepage as it does today.

This covers sub-projects 1 (crawler core) and 2 (groups at scale) of the
coverage work agreed on 2026-09-30:

1. crawler core, 2. groups at scale, 3. new event sources,
4. a resources registry (software, databases and datasets, courses),
5. discovery for that registry, 6. OpenAlex topics and statistics (done:
   PR #119).

Sub-projects 3–5 will add their own page kinds to the same crawler; this
design keeps them out.

Agreed with the maintainer:

- **Review:** batched PRs of at most 50 groups, which the maintainer
  merges. Nothing publishes without a merge.
- **Cadence:** one big crawl run by hand first, then a small nightly slice.
- **Approach:** directory-first. Crawl institution sites from known seeds
  to their directory pages, with a model call only on pages that look
  like directories; leads come with their own link, so verifying them
  needs no paid search.
- **Seeds:** our own data, OpenAlex institutions ranked by compchem
  output (free), and a few paid web searches a run for what no
  institution list reaches.
- **Models:** a paid model is allowed for the big crawl, kept cheap; the
  nightly slice uses the free model.

## Constraints from the repo

- AGENTS.md rule 1: every group field comes from a page fetched in the
  run; unchanged, since the resolver does the drafting.
- Rule 7: fetched pages are untrusted. The classifier has no tools, gets
  the page as delimited data, and answers only with indices into the
  page's own links; it never writes a URL. Every URL fetched passes
  `isPublicHttpsUrl` (https, public host, no IP literal or localhost).
- Politeness: every fetch goes through `politeFetch` (robots.txt,
  per-host spacing, blocklist). The crawler never bypasses it.
- No new npm dependencies (so no public-suffix list; see *Scope*).
- Rule 9: Conventional Commits, a branch per change, never push to `main`.
- OpenRouter's free models allow 20 requests a minute per account;
  `awaitModelSlot` spaces free-model calls within one process (PR #118).
  Two processes using the free model at once share that budget, so the
  crawler and the nightly run never overlap (see *Locking*).

## Components and data flow

```
seeds ─► frontier ─► politeFetch ─► score links ─► frontier
                         │
                         ▼ page passes the classifier gate?
                    classify (model, no tools, answers link indices)
                         │
                         ▼
                   group leads ─► resolveGroupLeads ─► batches of ≤ 50 ─► PRs
```

New files under `src/lib/discovery/crawl/`:

- `seeds.ts` — `collectSeeds(...)`: where crawling starts (below).
- `frontier.ts` — the persistent queue and visited map, in its own state
  file.
- `score.ts` — deterministic link scoring and the crawl scope.
- `classify.ts` — the model call that sorts a page and picks group links.
- `crawl.ts` — `runCrawl(...)`: one run of the loop, bounded by budgets.

Plus `scripts/discovery/groups-crawl.ts` (the runner, used both by hand
and by the nightly slice) and a call from `scripts/discovery/run.ts`.

## Seeds

Every run re-adds all seeds; a URL already visited within its revisit
period is ignored, so a newly merged group or a new OpenAlex institution
points the crawler somewhere new without any bookkeeping.

1. **Registry websites.** Every `website` in `data/groups/` and in open
   group PRs (`openGroupDrafts`, extended to the crawl branches below).
   For each, also its parent paths up to the host root:
   `https://chem.uni.edu/research/groups/smith/` adds
   `…/research/groups/` and `…/research/`, because the directory is
   usually one level up.
2. **Position adverts.** Each merged position's `url` host root, when the
   advert is on the institution's own site (not a job board or `t.me`).
3. **Group-listing sources** in `data/sources.yaml`.
4. **OpenAlex institutions.** For each site topic with an `openalex`
   mapping (at most 50 ids, so one OR filter), the top 200 institutions by
   works in the last three full years
   (`works?filter=topics.id:…,publication_year:…&group_by=authorships.institutions.id`),
   merged across topics and ranked by total works; then their
   `homepage_url` in batches of 100 ids
   (`institutions?filter=openalex:I1|…`). About 50 OpenAlex calls, within
   the free key's allowance. The homepage (for example
   `https://www.umich.edu`) is a seed with a low starting priority; the
   crawl reaches the chemistry department from it through scoring.
   Cached in the crawl state for 30 days.
5. **Search.** Up to `--max-searches` (default 5) OpenRouter `web`
   searches a run. Queries come from fixed templates ("computational
   chemistry research groups", "theoretical chemistry group") combined
   with a country, rotating through countries night by night. Only
   `url_citation` URLs are used, and only as **seeds**, never as leads:
   what they point to is crawled and classified like anything else.

## Crawl scope and scoring (`score.ts`)

- **Scope.** A frontier entry keeps the host of the seed it came from.
  A link is crawled only when its host equals that seed host or is a
  subdomain of the seed host with a leading `www.` removed (`umich.edu`
  admits `chem.umich.edu`). Links to other sites are never crawled; on a
  directory page they are only candidates for group leads. Without a
  public-suffix list this cannot tell `chem.umich.edu` from a sibling
  university on a shared suffix, but a seed is always an institution's
  own host, never a bare suffix, so the rule stays inside one institution.
- **Depth** at most 3 from the seed; **pages per host** at most 40 a run.
- **Link score** from the URL path and the link text, deterministic:
  - positive: *group(s), research, people, faculty, members, lab(s),
    theory, theoretical, computational, chemistry, materials, physics,
    molecular*;
  - negative: *news, event(s), login, calendar, publication(s), shop,
    admission(s), alumni, pdf, jpg, zip*, and any query string with
    `page=` or `sort=`.
- **Priority** = link score − 2 × depth; seeds from the registry and
  listings start high, OpenAlex homepages low. No host may take more than
  a quarter of a run's page budget.

## The frontier (`frontier.ts`)

`~/discovery-agent/crawl-state.json` (path from `CRAWL_STATE_PATH`),
separate from `state.json` because the frontier can reach tens of
thousands of URLs.

```jsonc
{
  "version": 1,
  "queue": [{ "url": "…", "priority": 7, "depth": 1, "seedHost": "umich.edu" }],
  "visited": { "https://…": { "at": "2026-10-01", "outcome": "directory" } },
  "openalexSeeds": { "fetchedAt": "2026-10-01", "urls": ["https://www.umich.edu"] },
  "searchCountryIndex": 12
}
```

- `outcome` is one of `directory`, `group-homepage`, `neither`,
  `not-classified` (fetched, below the gate), `skipped` (robots,
  blocklist, not HTML), `error`.
- A visited page is not fetched again for 180 days; a `directory` is
  re-queued after 30 days at high priority, since that is where new
  groups appear. An `error` is retried on the next run, like the
  resolver's errors (never cached).
- The queue holds at most 50,000 entries; the lowest priorities are
  dropped when it is full.
- The state is written **every 50 pages and at the end**, atomically
  (write a temp file, rename), so a crash or a kill during a multi-hour
  crawl loses at most 50 pages of work.

## Fetching

Every URL is first upgraded from `http:` to `https:` (`normalizeEventUrl`,
as the resolver does for listing links), then must pass
`isPublicHttpsUrl`, then goes through `politeFetch` with `force: true` (a directory must be read even if unchanged, to re-offer
its links). Up to 4 fetches run at once, always on different hosts. A
page whose final URL after redirects fails `isPublicHttpsUrl` or leaves
the seed's scope is dropped unparsed. A `429` or `503` pauses that host
for the rest of the run. Only
`text/html` bodies are parsed (`parseHTML` handles pages with no
document since PR #115).

## Classification (`classify.ts`)

- **Gate** (no model): a page is classified only if it has at least 8
  links with a positive score, or at least two strong keywords (*research
  groups, theory, theoretical, computational*) in its title or headings.
  Expected: one model call per 5–10 fetched pages.
- **Input:** the page text (at most 12,000 characters) as delimited data,
  and its links numbered, text and host only (at most 300).
- **Answer** (JSON schema, no tools):
  `{ "kind": "directory" | "group-homepage" | "neither", "groups": [linkIndex, …] }`.
  Indices outside the list are dropped.
- **Leads:** for each chosen index, a `GroupLead` with the link's text as
  the name, the link as `link`, the page title as `context`, the page as
  `origin`, `fromListing: true`. A `group-homepage` page becomes one lead
  whose link is the page itself.
- **Frontier:** a chosen link inside the seed's scope is also queued
  (group pages often link to sibling groups).
- Out of scope for now: event lists, sources, software, datasets and
  courses. Sub-projects 3–5 add their own `kind` values.

## Resolving and proposing

- Leads go to `resolveGroupLeads` unchanged, with `maxSearches: 0`: crawl
  leads carry their own link, and a lead whose link does not verify is
  simply not found (searches are spent on seeds, not names). The
  negative cache, the location retry, the Wikipedia/GitHub rejection and
  validation all apply as they do now.
- Candidates are filtered with `groupSkipReason` against the registry,
  every open group PR (`openGroupDrafts`, extended to include
  `discovery/groups-crawl/*` branches) and the run's own earlier
  candidates, with confidence ≥ 0.5.
- Accepted groups are proposed in batches of at most 50 with
  `proposeBatch`, on branches `discovery/groups-crawl/<date>-<n>`, labels
  `needs-review` and `group`, with the backfill's table body
  (`buildBackfillPrBody`, moved to `src/lib/discovery/` so both runners
  share it). No `Confidence:` line, so auto-approve never flags a batch.
- Batches are ordered by institution (the directory page each came
  from), so one PR reviews one department where possible.
- A batch PR closed without merging leaves its groups `drafted` in the
  negative cache for 90 days, so they are not proposed again; a group the
  maintainer deletes from a batch before merging is treated the same.

## Runs

`scripts/discovery/groups-crawl.ts`, flags (positive integers unless
noted):

| Flag | Default | Big crawl (suggested) |
| --- | --- | --- |
| `--max-pages` | 200 | 20,000 |
| `--max-classify` | 40 | 3,000 |
| `--max-searches` | 5 | 50 |
| `--max-prs` | 1 | 20 |
| `--max-tokens` | `MAX_TOKENS` | set from the chosen model's price |
| `--model <id>` | `LLM_MODEL_EXTRACT` | a cheap paid model |

- **Big crawl:** run by hand on the host, in the background, with a paid
  model. Before running it, the model is chosen from OpenRouter's current
  price list and the maintainer gets an estimate: roughly 3,000
  classifier calls at about 4,000 tokens and a few thousand verification
  calls at about 3,000 tokens, in the order of 20–30 million tokens.
  `--max-tokens` is the hard stop.
- **Nightly slice:** `scripts/discovery/run.ts` calls the same runner
  after the groups pass with the defaults and the free model: about 200
  pages, 40 classifier calls and 5 searches, at most one batch PR.
- **Locking:** the runner takes `~/discovery-agent/crawl.lock` (the pid,
  checked for liveness). The nightly run skips its slice when the lock is
  held; the big crawl refuses to start when it is, and the nightly
  `run.sh` is not started by hand while a big crawl runs.

## Failure handling

- A failed fetch marks that URL `error` and moves on; a host answering
  `429`/`503` is paused for the run.
- A failed classifier call (after the client's retries) leaves the page
  unvisited, so it is tried again next run; nothing is cached for it.
- Resolver errors are never cached (PR #118), and are reported per name.
- A failed PR proposal is logged and its groups are left un-`drafted` in
  the cache (the existing `forgetLookups` path), so the next run
  proposes them again.
- The nightly slice reports to the existing `discovery-failures` issue
  only when the crawl fails as a whole (as the groups pass does). The
  big crawl, run by hand, prints a JSON summary and exits non-zero on a
  whole-run failure.
- The state is saved every 50 pages, so a crash resumes where it
  stopped.

## Security

- The classifier has no tools and answers only with link indices; any
  URL it could write is ignored. Page text and links are delimited data
  with the standing instruction that they are not instructions.
- Every URL passes `isPublicHttpsUrl` before `politeFetch`, and every
  page's final URL after redirects is checked again before it is parsed,
  so no local or private host is read. The resolver separately rejects a
  verified group page that redirected to a non-public, profile,
  reference or origin host.
- Search citations are seeds only: they are crawled and classified, and
  their groups verified, before any draft exists.

## Testing

- `score.ts`: scope (same host, subdomain of a `www.`-stripped seed,
  another university rejected), depth, per-host cap, positive and
  negative scores, priority.
- `frontier.ts`: dedupe, revisit periods (180 days, directories 30),
  errors retried, the 50,000 cap dropping lowest priority, atomic save,
  resume after a partial run.
- `seeds.ts`: parent paths, position hosts (job boards and `t.me`
  excluded), OpenAlex ranking and homepage batching on recorded
  responses, search citations as seeds only.
- `classify.ts`: the gate; indices out of range dropped; a hostile page
  asking for another URL cannot add one; `group-homepage` making one
  lead.
- `crawl.ts`: a fixture site (department page → directory → three group
  pages, one off-site, one on a private host) produces the expected
  leads and frontier; budgets stop the run and are respected across four
  concurrent fetches; a `429` pauses the host.
- Runner: batches of 50, ordered by institution, on the right branches;
  duplicates against open crawl PRs skipped; the lock.
- End to end on fixtures only; no test reaches the network.

## Documentation

- `docs/discovery-agent.md`: a *Groups crawler* section (seeds, scope,
  classifier, budgets, the lock, the big crawl command).
- `docs/decisions.md`: crawling institution sites for group directories;
  batched review; OpenAlex institutions as seeds.
- `README.md`, `METADATA.md`: the runner and the new files.

## Delivery order

1. `score.ts` and `frontier.ts` with the state file.
2. `seeds.ts` (registry, positions, listings, OpenAlex, search).
3. `classify.ts`.
4. `crawl.ts`, the runner with its flags and the lock; batch proposing;
   `openGroupDrafts` extended to crawl branches; `buildBackfillPrBody`
   moved to `src/lib/discovery/`.
5. The nightly slice in `run.ts`; docs.
6. Operational: choose the paid model, send the maintainer the estimate,
   run the big crawl, and send the PR links.

## Amendments after review (2026-09-30)

- The resolver verifies a crawled lead on the directory's own site (the
  usual department layout); crawled lookups are cached by link, not by
  their often generic link text; a crawled lead whose link does not
  verify is not found (no search fallback).
- Found leads are kept in the crawl state until resolved or proposed, and
  the crawl phase uses at most half the token budget.
- A 4xx is cached as gone; timeouts, 429 and 5xx are retried on up to
  three later runs. Directories are re-queued after 30 days from where
  they were found.
- The crawl keeps its own fetch state and merges only its changed group
  lookups into `state.json`, which is now written atomically.
- A batch never reuses a branch that already exists that day.

## Out of scope

- Event sources, software, datasets and courses (sub-projects 3–5).
- Name-by-name search for crawl leads.
- Following links to other institutions from a directory page.
- DNS rebinding checks, as for every other fetch the agent makes.
