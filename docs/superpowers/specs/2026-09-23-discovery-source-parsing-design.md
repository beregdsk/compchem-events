# Discovery agent: fetching and parsing events from sources

Written: 2026-09-23

## Status

Sub-project of the phase 5 discovery agent (`docs/discovery-agent.md`). Implements
pipeline steps 2-5 (fetch, find candidates, extract, validate). Steps 6-7
(deduplicate, screen) already exist as a standalone classifier
(`src/lib/discovery/classify-candidate.ts`,
`docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`), built
deliberately ahead of this piece. Step 8 (open a pull request) remains a
separate, later task, as does the mailbox/IMAP source kind.

## Purpose

Given `data/sources.yaml`, fetch each source politely, find event candidates on
it, extract them into the event schema (via an LLM for anything that isn't
already structured), and validate the result — producing a list of candidate
events ready for the existing classifier to deduplicate and screen. This never
publishes anything and never calls `classifyCandidate()` itself; wiring the two
together, and opening pull requests from the result, is separate work.

## Scope

**In scope:** the five source kinds `data/sources.yaml` currently uses —
`listing-page`, `event-page`, `rss`, `ical`, `telegram-channel` — plus polite
fetching (robots.txt, rate limiting, conditional re-fetch via a local state
file), LLM-based extraction for the kinds that need it, and validation of the
result against the existing schema and semantic rules.

`mailing-list-archive` needs no special handling: `docs/discovery-agent.md`
already treats it as an ordinary `listing-page` (CCL's page is listed as
`listing-page` in `data/sources.yaml` for this reason), and no source currently
uses that kind label, so no separate code path is built for it.

**Out of scope:** the `mailbox`/IMAP source (explicitly unimplemented per
`docs/discovery-agent.md`), calling `classifyCandidate()` from this pipeline,
and opening pull requests. This task's output is a list of validated candidate
drafts; a later task feeds each one to `classifyCandidate()` and, for
`verdict: 'add'`, opens a PR.

## Architecture

```
src/lib/discovery/
  sources.ts           load and type data/sources.yaml
  fetch.ts              polite fetch: User-Agent, robots.txt, per-host rate
                         limit, ETag/content-hash conditional fetch
  state.ts              read/write the JSON state file at STATE_PATH
  extract-client.ts     OpenRouter chat-completions client, JSON-schema
                         response mode, for the "generate structured event
                         JSON from text" call
  html.ts               linkedom helpers: link extraction, HTML-to-text,
                         telegram post splitting
  parsers/
    ical.ts              VEVENT -> candidate draft directly, no LLM call
    rss.ts                <item>/<entry> -> one extraction input each
    listing.ts            listing-page -> event-page links, fetch each new
                           one once
    page.ts                event-page (including a link fetched from a
                           listing) -> one extraction input
    telegram.ts            channel page -> one extraction input per post
  pipeline.ts           per-source orchestration: fetch -> find candidates ->
                         extract -> validate -> candidate drafts
scripts/discovery/
  parse-sources.ts      CLI: loads data/sources.yaml, runs the pipeline over
                         every source, prints validated candidate drafts as
                         JSON to stdout, logs progress/errors to stderr
```

`classify-candidate.ts`'s `CandidateEvent` type gains `'type'` in its `Pick<
RawEvent, ...>` list (see *Validation and the candidate draft* below); this is
its only change.

## Data flow by source kind

Every kind ends at the same place: zero or more **candidate drafts**, each a
structurally complete `RawEvent` (see *Validation and the candidate draft*).

- **`ical`** — fetch the feed (still through the conditional-fetch cache),
  parse with `ical.js` (already a dependency, currently dev-only for building
  our own `.ics` output; this promotes it to a runtime dependency of the real
  parsing path too). Map each `VEVENT` straight to a candidate draft. No LLM
  call — this is the one kind the discovery-agent spec always intended to skip
  it for, since dates and titles arrive already typed.
- **`rss`** — fetch the feed, parse `<item>`/`<entry>` elements via `linkedom`.
  Each item's title, description/summary and link become one extraction input
  (title/description alone rarely carry format, location or topics reliably,
  so RSS still goes through the LLM, unlike `ical`).
- **`listing-page`** — fetch the listing page, extract same-host `<a>` links
  via `linkedom`, and fetch each link not already in state as an `event-page`
  (one fetch per new link, per run).
- **`event-page`** — fetch, strip HTML to visible text via `linkedom`, one
  extraction input for the whole page.
- **`telegram-channel`** — fetch `t.me/s/<channel>`, split the page into
  individual post blocks via `linkedom`, one extraction input per post. Most
  posts will extract to nothing; that is expected and identical in kind to any
  other low-precision source — nothing here is treated as more or less trusted
  than a scraped web page.

Every extraction input (everything except `ical`) is passed, one at a time, to
`extract-client.ts`.

## Fetch layer

`fetch.ts` is the one fetcher every kind goes through:

- **User-Agent** built from `site.config.ts`'s existing `contactEmail` and
  `repoUrl`: `CompChem Events Discovery Agent (+<repoUrl>; <contactEmail>)`. No
  new site-config fields needed.
- **robots.txt**: fetched and cached per host in the state file. A disallowed
  path is skipped and logged, never fetched.
- **Rate limiting**: a minimum delay between requests to the same host,
  tracked as `lastRequestAt` per host in state.
- **Conditional fetch**: state stores `{ etag?, contentHash, fetchedAt }` per
  URL. A server `ETag` is preferred; otherwise a hash of the previous response
  body stands in. An unchanged page short-circuits to zero candidates for that
  URL this run — it is not re-parsed.
- **`MAX_PAGES` cap**: the pipeline stops issuing new fetches once the run hits
  the cap, finishes any in-flight work, and logs that the cap was hit.

`state.ts` owns a single JSON file at `STATE_PATH`:

```
{
  "hosts": { "<host>": { "robotsTxt": "...", "lastRequestAt": "<iso>" } },
  "pages": { "<url>": { "etag": "...", "contentHash": "...", "fetchedAt": "<iso>" } }
}
```

`STATE_PATH` is required, with no default — the discovery-agent spec already
says this state must not live in the repo, and a hard-coded in-repo default
would be an easy way to violate that by accident.

## Extraction

`extract-client.ts` calls OpenRouter's chat-completions endpoint (same
provider and API key as `jev-client.ts`'s Decisions API call, a different
endpoint — jev answers typed yes/no questions and cannot generate structured
event JSON) with `response_format` set to a JSON Schema built from the
extractable `RawEvent` fields: `title`, `type`, `start_date`, `end_date`,
`format`, `location` (`city`/`country`/`venue`), `url`, `organizer`, `topics`,
`description`, plus `confidence` (the model's own estimate) and `source_url`
(the page the text came from). `topics` is constrained to the vocabulary in
`data/topics.yaml`, passed into the prompt.

New env var `LLM_MODEL_EXTRACT`, required with no default — an extraction
model is a deliberate choice, unlike jev's pinned `~typesafe/jev-latest`.
`LLM_API_KEY` and `LLM_BASE_URL` are shared with the existing jev client.

**Security**, matching `docs/discovery-agent.md`'s *Security model* exactly:
the page/post text is the only thing placed in the request's data portion,
never in the system prompt; the system prompt is fixed in code and states
explicitly that any instructions found in the input must not be followed; the
call has no tools and no browsing; HTML is always converted to plain text
before it reaches the model, never sent as markup.

A response that fails to parse as the expected schema, or that the model
declines to produce (no event found on this input), yields zero candidates for
that input — logged, not an error that stops the source.

## Validation and the candidate draft

`classify-candidate.ts`'s `CandidateEvent` deliberately omits `id`, `type`,
`added` and `last_verified` — extraction wasn't built yet when it was written.
The full schema requires all four, so this task's extraction step produces a
**complete candidate draft**, a structural `RawEvent`, rather than inventing a
second, weaker validation path:

- `type` — added to the extraction schema; the model classifies
  conference/workshop/school/symposium/webinar/hackathon alongside everything
  else. `CandidateEvent`'s `Pick<RawEvent, ...>` gains `'type'`.
- `id` — slugified from title and start-year, following the existing
  `<slug>-<year>` convention (reuses `normaliseTitle`, hyphenated).
- `added` / `last_verified` — set to the run date. This is exactly what the
  (separate, later) PR-opening step would set anyway; the discovery-agent
  spec's "reviewer must confirm them" is a review instruction, not a reason to
  leave the fields blank.

Because the draft is a structural `RawEvent`, both `validateEvent` and
`classifyCandidate` run against it completely unmodified — no parallel or
partial validation logic. A draft that fails `validateEvent` is discarded and
logged with the reason, per step 5 of `docs/discovery-agent.md`.

## Configuration

Environment variables this task reads: `LLM_API_KEY`, `LLM_BASE_URL` (default
shared with the jev client), `LLM_MODEL_EXTRACT` (required, no default),
`MAX_PAGES` (default 200), `STATE_PATH` (required, no default).
`GITHUB_TOKEN`, `GITHUB_REPO`, `MAX_PRS` and `MAX_TOKENS` are not read by this
task — nothing here opens a pull request. Fail fast with a clear message if a
required value is missing, per `docs/discovery-agent.md`'s *Configuration*
section.

## Dependencies

- **`linkedom`** (new): one small, pure-JS DOM library covering listing-page
  link extraction, HTML-to-text stripping, telegram post splitting, and
  RSS/Atom item parsing via `querySelectorAll`. One dependency to justify
  under `AGENTS.md` rule 8 rather than several format-specific ones, and safer
  than hand-rolled regex HTML parsing against the hostile input this pipeline
  is built to handle.
- **`ical.js`** (already present, moves from `devDependencies` to
  `dependencies`): currently only exercised by tests building this site's own
  `.ics` output; this task is its first real runtime use, parsing incoming
  feeds.

## Error handling

One source failing — a fetch error, a malformed feed, a bad LLM response —
is caught, logged with the source name and reason, and the pipeline moves on
to the next source; it never aborts the run. The CLI (`parse-sources.ts`)
exits non-zero only on configuration errors (a missing required env var), so a
cron wrapper can alert on real problems and ignore transient network noise —
matching `docs/discovery-agent.md`'s *Failure handling* section.

## CLI

`scripts/discovery/parse-sources.ts`: no arguments, reads `data/sources.yaml`,
runs the pipeline over every source, prints the final JSON array of validated
candidate drafts to stdout, and writes progress/skip/error logging to stderr.
It does not write files or call `classifyCandidate()` — piping its stdout into
a future wiring step (or, today, `scripts/discovery/classify.ts` by hand for
one candidate at a time) is how the two pieces connect until that wiring task
exists.

## Testing

Fixture-based, no network or real API calls in CI, following the pattern
`jev-client.test.ts` and `classify-candidate.test.ts` already use (a stubbed
`fetchImpl`) plus a stubbed extraction client:

- Recorded real pages/feeds as fixtures under `tests/discovery/fixtures/sources/`,
  one set per kind (`ical`, `rss`, `listing-page` + a linked `event-page`,
  `telegram-channel`).
- Adversarial fixtures: prompt-injection text embedded in page/post content,
  a malformed feed, a page with missing required fields. Assert the pipeline
  drops or logs them and never produces an invalid candidate draft.
- Idempotence: running the fetch layer twice against unchanged fixtures
  (same `STATE_PATH`) produces zero new candidates on the second run.
- `robots.txt`-disallowed and rate-limited paths are asserted skipped, not
  fetched.
