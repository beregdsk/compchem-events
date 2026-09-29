# Discovery agent (follow-up, phase 5)

**Status: implemented.** All steps (load sources, fetch, extract, validate, deduplicate/screen, open a PR) exist: fetch/extract/validate is `src/lib/discovery/pipeline.ts`, deduplicate/screen is `src/lib/discovery/classify-candidate.ts`, and PR-opening is `src/lib/discovery/orchestrator.ts`, composed by the cron entrypoint `scripts/discovery/run.ts` — see *Deployment* below. Mailbox/IMAP ingestion (see *Mailing lists*) is also implemented (`src/lib/discovery/mailbox-client.ts`) and live: the mailbox account, its `discovery` folder, and the Psi-k subscription were all confirmed working end-to-end 2026-09-27 (see `data/sources.yaml`'s live `kind: mailbox` entry).

## Purpose

Find candidate events on known sources, extract them into the event schema, and open **pull requests for human review**. It never publishes anything itself.

## Where it runs

A small VDS owned by the maintainer, as a scheduled job (daily or weekly cron). It is a batch script, not a long-running service. It uses an external LLM API for extraction only, so no local model or GPU is needed.

## Pipeline

1. **Load sources** from `data/sources.yaml`: a list of `{name, url, kind, notes}` entries, where `kind` is one of `SOURCE_KINDS` in `src/lib/discovery/sources.ts` (see *Sources* below).
2. **Fetch** each source politely: identify with a User-Agent that includes the project URL and a contact address, honour `robots.txt`, rate-limit per host, cache with ETag or content hash, and skip unchanged pages (state in a local JSON or SQLite file, not in the repo).
3. **Find candidates**: extract links to event pages from listing pages, then fetch each new event page once.
4. **Extract**: send the page text to the LLM with a fixed prompt asking for JSON matching the event schema, plus a `confidence` value and the exact `source_url`. Use structured output or JSON mode where available.
5. **Validate**: run the output through `validateEvent` from `scripts/validate.ts`. Discard anything that fails, and log why.
6. **Deduplicate** against existing events and blocklist (same URL, or same title plus start date, or fuzzy title match on the same dates). Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
7. **Screen** against `docs/curation-policy.md`: apply the blocklist, and flag events with red-flag signals for the reviewer instead of silently dropping them. Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
8. **Open a PR** on a branch named `discovery/YYYY-MM-DD`, one YAML file per candidate event, with a body listing for each event the source URL, confidence and any flags. Add the label `needs-review`. Set `added` to the run date.

## Security model

Web pages are hostile input. The extraction step must be unable to do anything except return JSON.

- The extraction call has **no tools**, no browsing, and no access to secrets beyond the API key. Page text is passed as clearly delimited data, and the prompt says instructions inside it must be ignored.
- Never execute, evaluate or render fetched content. Fetch text only.
- Output is accepted only if it validates against the schema. Free-text fields are length-limited and stripped of markup.
- Run the job as an unprivileged user or in a container with no other credentials on the machine.
- **Credentials:** the LLM API key must have a spending cap set in the provider console. The GitHub token must be fine-grained, limited to this one repository, with only the permissions needed to push a branch, open a PR and file the failure-tracking issue (contents write, pull requests write, issues write). It must not be able to merge or change settings. Store both as environment variables or a root-only file, never in the repo.
- **Caps per run:** maximum pages fetched, maximum tokens, maximum PRs opened. The job stops and logs when any cap is hit.

## Configuration

All configuration by environment variables, validated by `scripts/discovery/run.ts`'s `buildConfig`, which fails fast with a clear message if any required value is missing or malformed:

| Variable | Required | Default |
|---|---|---|
| `LLM_API_KEY` | yes | — |
| `LLM_MODEL_EXTRACT` | yes (e.g. `dots-studio/dots-3-note-preview:free`) | — |
| `STATE_PATH` | yes | — |
| `GITHUB_TOKEN` | yes | — |
| `GITHUB_REPO` | yes (`owner/repo`) | — |
| `LLM_BASE_URL` | no | extraction (chat-completions) endpoint's default |
| `LLM_BASE_URL_CLASSIFY` | no | classification (Decisions API) endpoint's default — a different endpoint from `LLM_BASE_URL`, so proxying one does not proxy the other |
| `LLM_MODEL` | no | the classifier's own default model |
| `MAX_PAGES` | no | 200 |
| `MAX_TOKENS` | no | 500000 |
| `MAX_PRS` | no | 20 |
| `IMAP_HOST` | no (all three or none — see below) | — |
| `IMAP_USER` | no | — |
| `IMAP_PASSWORD` | no | — |
| `IMAP_PORT` | no | 993 |
| `IMAP_SECURE` | no | `true` (anything but the literal string `false`) |

`IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD` must be set all together or not at all — setting only some fails fast (a likely typo), same as every other required-together value here. With none set (for example, a local dry run), every `kind: mailbox` source is skipped with a log line and nothing else about the run changes. The production deployment sets all three (see *Mailing lists*).

## Sources

`data/sources.yaml` holds them. The first seventeen entries were compiled and fetched on 2026-09-23, and more have been added since, each fetched first. That file documents its own format and keeps checked-but-unusable candidates in a commented block at the bottom. `npm run validate` checks it in CI (`validateSources` in `src/lib/discovery/sources.ts`): an unknown field or kind, a non-https or repeated url, or a missing `last_checked` fails the build, where `loadSources` would otherwise skip the entry silently at run time.

Three of the URLs this document originally suggested were already dead when the list was compiled (`cecam.org/workshop-list`, `molssi.org/events/`, `acscomp.org`), and `www.ictp.it` refuses a scripted user agent. Hence the rule in that file: every entry is fetched before it is added, and `last_checked` says when.

Five source kinds were added beyond the four the original version of this document listed:

- `inline-listing` — a page that lists several events as text rather than as links to per-event pages (CCL's announcements, CCPBioSim, the EuChemS division's conferences, SCM). The page's own text goes to the model once, in a listing mode that returns every in-field event it states; each is then validated and screened like any other candidate.
- `cecam-api` — CECAM's program, which its page renders in the browser from a JSON API (`src/lib/discovery/cecam-client.ts`). The API gives each event's dates and organisers; the event's own page, fetched like any other, gives its description, and both go to the model together.
- `ical` — a calendar feed, parsed directly, since dates and titles arrive already typed. A feed carries no topics, so each event's topics come from keyword matches against `data/topics.yaml` (`src/lib/discovery/keyword-topics.ts`); only an event no keyword places goes to the extraction model, like any page. Telluride Science publishes one.
- `mailbox` — a list we are subscribed to, read over IMAP (`src/lib/discovery/mailbox-client.ts`). See below. Psi-k is the live entry.
- `telegram-channel` — a public channel, fetched at its anonymous web-preview path (`t.me/s/<channel>`, not `t.me/<channel>`, which redirects to the app). No login or bot token needed. Treat it like a listing-page: low precision, screen every post against `docs/curation-policy.md`. A post is exactly as hostile as a web page — same extraction pipeline in *Security model*, no exceptions. `data/sources.yaml` has a live example.

Existing aggregators such as https://labinitio.org/ are for **coverage comparison only**. Do not scrape or republish another site's curation.

## Mailing lists

Much of this field's event traffic moves by mailing list rather than by web page. Where a list has an open web archive, it is an ordinary source and needs nothing special: CCL's conference announcements are a plain public page and are listed as `listing-page`.

Where it does not, the archive is useless to us. Psi-k is the case that decided this. It used to mirror its list to a forum at `psi-k.net/wps-forums/events/`, and the sitemap advertised thousands of post URLs — but every one of them returned HTTP 200 serving the *homepage* to an anonymous fetch. The posts were login-gated, and the public RSS feed carried only a fraction of the traffic. (The list itself moved again in 2025, to JISCMail — see the commented note in `data/sources.yaml` — which changes nothing about the reasoning below: it is still an ordinary subscriber mailing list with no open archive.)

So for lists like Psi-k, **subscribe and read the mail**:

- A dedicated address subscribed to the lists, never the maintainer's personal mailbox, is the ideal — one account, one purpose, revocable. Where that's not practical (as deployed: a personal Gmail account, chosen after the phone-verification and OAuth-only walls hit on several dedicated-mailbox providers), the credential still grants full-mailbox access regardless of which folder the code reads — a filter that routes every list's mail into one shared `discovery` label/folder (see `data/sources.yaml`'s format comment) is the minimum substitute isolation, never reading INBOX directly.
- Read-only IMAP. The agent never sends, replies, deletes or marks. Credentials by environment variable (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`), alongside the others, and an app password rather than the account password where the provider offers one.
- **A message body is exactly as hostile as a web page.** It goes into the same extraction step, as clearly delimited data, with no tools and no ability to act — see *Security model*. Mail is in fact worse than a page: anyone can send to a list, and the `From` header is not evidence. Attachments and HTML parts are not fetched or rendered; take `text/plain` and fall back to stripped HTML.
- Deduplicate on `Message-ID`, and keep the same state file as the web sources. A list that cross-posts a CECAM workshop must not produce a second candidate.
- Everything else is unchanged: schema validation, blocklist, curation screening, one pull request for human review.

Implemented as `src/lib/discovery/mailbox-client.ts` (IMAP + MIME parsing), wired into the `kind: 'mailbox'` case in `pipeline.ts`. It was deliberately cheap to add: just another text source feeding the same extract → validate → screen → PR pipeline. The mailbox account, its `discovery` folder and the Psi-k subscription were confirmed working end to end on 2026-09-27, and `data/sources.yaml` has the live `kind: mailbox` entry.

## Human review

Every discovered PR gets the `needs-review` label. Its body is the raw
candidate fields plus the classifier's confidence and per-criterion scores —
no separate checklist, since one would only restate the fields already shown
above it. A reviewer checks those fields against the event's official page
and `docs/curation-policy.md` directly before merging.

After each run, a separate pass (`auto-approve.ts`) revisits every currently
open discovery PR — not just this run's candidates, since CI on a PR opened
days ago finishes long after that run has exited — and adds a
`high-confidence` label plus an explanatory comment on any whose recorded
confidence is at least 0.90 and whose `check`/`e2e` CI jobs both passed.
It's a comment, not a formal GitHub approval: GitHub rejects an actor
approving its own PR, and the same token opens every discovery PR. This
never merges anything and never replaces review: **automatically discovered
events are still never published without a human clicking merge.** It only
lets a maintainer skim straight to the highest-confidence PRs instead of
re-deriving that judgement by hand.

## Testing

- Record real pages as fixtures in `tests/discovery/fixtures/` and test extraction with a stubbed LLM client returning canned JSON. CI must never call the real API.
- Include adversarial fixtures: pages containing prompt-injection text, invalid dates, missing fields, and duplicate events. Assert the pipeline drops or flags them and never produces an invalid file.
- Test idempotence: running twice on unchanged sources opens no second PR.

## Failure handling

- One source failing must not stop the run. Log the error and continue.
- Sources run four at a time (`SOURCE_CONCURRENCY` in `pipeline.ts`). Page budgets are reserved before each fetch, per-host politeness slots are reserved before each wait, and a URL is fetched at most once per run, so concurrency never overshoots `MAX_PAGES` or hits one host faster than the per-host interval. `MAX_TOKENS` is checked before each LLM call, so calls already in flight in other sources can overshoot it slightly.
- Extraction retries a malformed response, a timeout, a dropped connection, a 5xx or a 429 up to three attempts; a 429 waits until the rate limit's stated reset (OpenRouter's free tier allows 20 requests a minute per account).
- A listing page's links are followed only when they plausibly lead to one event: links in site chrome (nav, header, footer, sidebar, menus), downloads, site pages (about, contact, privacy, membership…), past-event pages and the listing's own or ancestor pages are skipped (`parsers/listing.ts`). The filter is structural only, never by topic — a missed event is worse than a wasted fetch. A listing that marks a next page (`rel="next"`) is followed up to five pages deep, since sites that announce months ahead push in-field events off page 1.
- The relevance pre-filter before each LLM call knows English, Russian, Italian/French/German and Chinese/Japanese terms, and the model is told to return English titles and descriptions whatever the source language.
- Repeated failures on a source produce a single tracking issue, not a new one each run.
- The job exits non-zero only on configuration errors, so a cron wrapper can alert on real problems and ignore transient network noise.
- Every outbound HTTP call (page fetches, robots.txt, the extraction/classification/GitHub APIs) goes through `fetchWithTimeout` (`src/lib/discovery/http.ts`, 60s default, 90s for LLM calls) rather than a bare `fetch`. Plain `fetch` has no timeout of its own, so a server that accepts a connection and never responds hangs that call — and, with no timeout, the whole run — forever; this was observed live, not theoretical.

## Deployment

The pipeline (`src/lib/discovery/pipeline.ts`), the classifier
(`src/lib/discovery/classify-candidate.ts`) and the PR-opening orchestrator
(`src/lib/discovery/orchestrator.ts`) are composed by
`scripts/discovery/run.ts`, the actual cron entrypoint. `Dockerfile.discovery`
builds it into an image that runs as the unprivileged `discovery` user with
no credentials baked in — everything comes from the environment at
`docker run` time:

```
docker build -f Dockerfile.discovery -t discovery-agent .
mkdir -p /var/lib/discovery-agent
docker run --rm \
  --env-file /etc/discovery-agent.env \
  -v /var/lib/discovery-agent:/state \
  discovery-agent
```

The `-v` mount is required, not optional: `--rm` discards the container's
own filesystem on exit, so without it `STATE_PATH` (below) would reset on
every run — no page would ever look "unchanged", so every run would
re-extract and re-spend tokens on every source, and push a redundant
update commit to every open PR.

`/etc/discovery-agent.env` (root-only, never in the repo) holds
`LLM_API_KEY`, `LLM_MODEL_EXTRACT`, `STATE_PATH=/state/state.json` (inside
the mounted volume above, so state survives between runs), `GITHUB_TOKEN`,
`GITHUB_REPO`, and optionally `LLM_BASE_URL` (extraction only),
`LLM_BASE_URL_CLASSIFY` (classification only — these are two different
endpoints and must be set independently when proxying either one),
`LLM_MODEL`, `MAX_PAGES`, `MAX_TOKENS`, `MAX_PRS`, and — for the
`kind: mailbox` sources (see *Mailing lists*) — `IMAP_HOST`, `IMAP_USER`,
`IMAP_PASSWORD` and optionally `IMAP_PORT`/`IMAP_SECURE` — see
*Configuration* above for what each does and its default.

Two credentials stay human-only operational steps, per this document's
*Security model*:

- Set a spending cap on the LLM API key in the provider's console before
  the first run.
- Mint `GITHUB_TOKEN` as a fine-grained personal access token scoped to
  this one repository only, with **contents: write**,
  **pull requests: write** and **issues: write** (the last one is needed
  to file and close the source-failure tracking issue) — never admin,
  never merge.

The cron entry itself (e.g. a daily line in the `discovery` user's
crontab running the `docker run` command above) is set up on the VDS by
the maintainer; it is infrastructure outside this repository.

### Running without Docker

If the VDS has no Docker (and no root to install it), run `run.ts`
directly under a dedicated, non-root system account instead — the same
unprivileged-execution requirement, without a container:

```
mkdir -p ~/discovery-agent && chmod 700 ~/discovery-agent
```

Put the same variables from *Configuration* into `~/discovery-agent/.env`
(`chmod 600`, never committed), with `STATE_PATH=~/discovery-agent/state.json`.
A small wrapper script loads it and runs the agent, since plain `cron` has
no `--env-file` equivalent:

```bash
#!/usr/bin/env bash
set -euo pipefail
AGENT_DIR="$HOME/discovery-agent"
REPO_DIR="$HOME/agg"          # path to this repo's checkout

set -a
source "$AGENT_DIR/.env"
set +a

cd "$REPO_DIR"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$AGENT_DIR/run.log"
./node_modules/.bin/tsx scripts/discovery/run.ts >> "$AGENT_DIR/run.log" 2>&1 \
  || echo "discovery agent exited non-zero: $?" >> "$AGENT_DIR/run.log"
```

`chmod 700` that script, then add one crontab line (`crontab -e`) pointing
at it, at whatever cadence *Where it runs* calls for. **Caution:** `buildConfig`
only checks that each required variable is non-empty, not that it holds a
real credential — a still-placeholder `.env` will make each run genuinely
fetch every source and fail every extraction call with a 401, rather than
failing fast before touching the network. Fill in real secrets before the
first scheduled fire, or run the script once by hand to confirm it fails
the way you expect.
