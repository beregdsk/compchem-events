# Discovery agent: PR-opening orchestrator

Written: 2026-09-25

## Status

Sub-project of the phase 5 discovery agent (`docs/discovery-agent.md`). Steps
1-5 (load sources, fetch, find candidates, extract, validate) are built as
`src/lib/discovery/pipeline.ts` / `scripts/discovery/parse-sources.ts`. Steps
6-7 (deduplicate, screen) are built as `src/lib/discovery/classify-candidate.ts`
/ `scripts/discovery/classify.ts` (see
`docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`).
Both stop short of writing anything to GitHub. This design covers the
remaining piece: step 8 (open a PR for human review), the config/caps that
gate a full run, failure tracking, and the deployment artifact — turning the
existing library functions into the actual cron job.

## Purpose

Take the candidates `runPipeline` produces, classify each one, and for every
`add` verdict, open (or update) a `needs-review` pull request containing one
event YAML file, so a human reviewer can accept or reject it. Nothing is
ever published automatically — `docs/curation-policy.md` already states
that automatically discovered events are never published without human
review, and this design does not change that.

## Scope

**In scope:** a GitHub REST client, the orchestrator that drives one full
run (classify → draft → open/update/skip a PR, per candidate), a new CLI
entrypoint, the config and per-run caps, the source-failure tracking issue,
and a Dockerfile for the VDS cron job.

**Out of scope (separate, later work):** the mailbox/IMAP source
(`docs/discovery-agent.md` already defers it — "build it with the rest of
the agent, not before: there is nothing for it to feed yet" — and this
design doesn't change that; the orchestrator is source-agnostic, so adding
mailbox candidates later needs no changes here). Registering the LLM
spending cap and minting the fine-grained `GITHUB_TOKEN` remain human-only
operational steps, not code.

## Decisions

A few points where `docs/discovery-agent.md`'s prose reads as ambiguous or
singular where this design needs to be plural; recorded here rather than
re-litigated:

- **One PR per candidate**, not one PR per run bundling every candidate.
  Easier for a reviewer to accept/reject one event at a time. `MAX_PRS`
  caps how many a single run may open.
- **Branch name is `discovery/<candidate id>`**, not
  `discovery/YYYY-MM-DD` — GitHub requires a unique branch per PR, and a
  stable (date-free) name is what makes idempotence possible across runs on
  different days (see *Idempotence* below).
- **GitHub access is a raw `fetch` wrapper**, matching `extract-client.ts`
  and `jev-client.ts`, not a new SDK dependency (`AGENTS.md` rule 8: prefer
  small dependencies).
- **`MAX_TOKENS` is one combined total** across extraction and
  classification calls, not two separate caps — the spec describes it as a
  single number and a single "job stops when any cap is hit" behaviour.
- **The failure-tracking issue is find-or-create-and-update on any
  failure**, not gated behind a consecutive-failure streak — "repeated
  failures... produce a single tracking issue, not a new one each run"
  means the *issue* doesn't multiply, not that failures must repeat before
  it's opened. This mirrors `links.yml`'s existing pattern exactly.

## Architecture

Two new library modules, following the existing pattern of a `src/lib`
module plus a thin `scripts` CLI wrapper (`pipeline.ts` +
`parse-sources.ts`, `classify-candidate.ts` + `classify.ts`):

- **`src/lib/discovery/github-client.ts`**: a thin `fetch` wrapper over the
  GitHub REST API. Operations: get a ref (does a branch exist, and does it
  have an open PR), create a branch from the default branch's HEAD,
  create-or-update a single file on a branch (the Contents API does this in
  one call — no separate blob/tree/commit dance needed for a one-file
  change), open a PR, add a label, and find-or-create-or-close an issue by
  title. Every method takes `{ token, repo, fetchImpl? }`; `fetchImpl`
  defaults to the global `fetch`, same as `extract-client.ts`, so tests can
  stub it.
- **`src/lib/discovery/orchestrator.ts`**: `runDiscoveryRun(options)`, the
  new logic that ties everything together. For each candidate from
  `runPipeline`: `synthesizeDraft` → `draftFilePath` → `classifyCandidate`
  → open/update/skip a PR via `github-client.ts` (see *Control flow*
  below). For `PipelineResult.errors`, drives the tracking-issue logic.
  Returns a summary (PRs opened/updated, candidates skipped and why, cap
  hits) for the CLI to log.
- **`scripts/discovery/run.ts`**: the new cron entrypoint. Same
  `buildConfig`/`main` shape as `parse-sources.ts`, extended with
  `GITHUB_TOKEN`, `GITHUB_REPO`, `MAX_TOKENS`, `MAX_PRS`. Calls
  `runDiscoveryRun` and logs its summary.

`parse-sources.ts` and `classify.ts` are unchanged and keep their existing
purpose as standalone debug tools (dump candidates to stdout; classify one
saved candidate file by hand). `run.ts` is the only thing that writes to
GitHub.

## Control flow

For each run, `runDiscoveryRun`:

```
result = runPipeline(...)                       // existing: steps 1-5
prsOpened = 0
for candidate of result.candidates:
  draft = synthesizeDraft(candidate, today)
  path = draftFilePath(draft)
  classification = classifyCandidate(candidate, ctx)   // existing: steps 6-7

  if classification.verdict === 'skip':
    log(reason); continue                        // dedupe/blocklist/low-confidence — never opens a PR

  if prsOpened >= maxPrs:
    log('skipped: MAX_PRS reached'); continue

  branch = `discovery/${draft.id}`
  ref = github.getBranch(branch)                  // does it exist, and is there an open PR from it

  if ref.exists && !ref.openPr:
    log('already reviewed (merged or closed), skipping'); continue

  if ref.exists && ref.openPr:
    github.updateFile(branch, path, yaml(draft))   // rerun found updated content; refresh in place
    github.updatePrBody(ref.openPr, prBody(candidate, classification, draft))
  else:
    github.createBranch(branch)
    github.putFile(branch, path, yaml(draft))
    pr = github.openPr(branch, title, prBody(candidate, classification, draft))
    github.addLabel(pr, 'needs-review')

  prsOpened += 1

github.syncFailureIssue(result.errors)             // see Failure tracking
```

**PR content**: title is the event title; body includes the source URL,
`classification.confidence`, the three criteria scores (`relevant`,
`credible`, `red_flag`) so a reviewer sees a red-flag signal even on an
`add` verdict rather than it being silently absorbed into one number, and
the human-review checklist from `docs/discovery-agent.md`'s "Human review
checklist" section, embedded as a constant in `orchestrator.ts` (GitHub
only auto-fills `pull_request_template.md` for PRs opened through the web
UI, not the API, so this must be inlined — same reasoning as the hardcoded
prompt strings in `extract-client.ts`). `draft.added` and
`draft.last_verified` are both set to the run date, per
`docs/discovery-agent.md` step 8.

**Idempotence**: keyed off the stable `discovery/<id>` branch, never the run
date. A same-day or later rerun that meets the same candidate again either
refreshes the still-open PR or is a no-op (branch exists, no open PR means
it was merged or rejected — never reopened). This is what
`docs/discovery-agent.md`'s testing requirement — "running twice on
unchanged sources opens no second PR" — needs, and it degrades sensibly
when the source page *has* changed (updates in place) or the candidate was
already resolved by a human (skipped for good).

## Config and caps

`run.ts`'s `buildConfig` extends the existing shape
(`scripts/discovery/parse-sources.ts`) with:

| Var | Required | Notes |
|---|---|---|
| `GITHUB_TOKEN` | yes | fine-grained, this repo only, contents+PR write, no merge |
| `GITHUB_REPO` | yes | `owner/repo` |
| `MAX_TOKENS` | no, default 500000 | combined extraction + classification tokens |
| `MAX_PRS` | no, default 20 | PRs opened or updated per run |

All fail-fast with a clear message on an invalid value, same as today's
`LLM_API_KEY`/`STATE_PATH`/`MAX_PAGES` checks.

**`MAX_TOKENS`** is one running total across both LLM call types the run
makes: `extract-client.ts`'s OpenRouter chat-completions responses (add
`usage.total_tokens` to `ChatCompletionResponse`) and `jev-client.ts`'s
Decisions-API responses (`usage.input_tokens + usage.output_tokens`).
Checked before starting each new page fetch or classify call — once
continuing would exceed the cap, `runDiscoveryRun` stops starting new LLM
work, logs it, and finishes cleanly with whatever it already produced.
Same halt shape as today's `maxPages`/`pagesFetched` bookkeeping in
`pipeline.ts`.

**`MAX_PRS`** stops the orchestrator from *opening or updating* further
PRs once reached; it keeps evaluating and logging remaining candidates (so
the run's summary is complete) but makes no further GitHub write calls.

## Failure tracking

No new state file. On every run, after processing all candidates,
`runDiscoveryRun` calls `github.syncFailureIssue(result.errors)`:

- `result.errors` non-empty: find the open issue titled "Discovery agent
  source failures" (by title, same list-and-match approach `links.yml`
  uses for "Dead links in event data"); create it if absent, otherwise
  replace its body with the current run's failure list (source name +
  error message per line). One source failing does not stop the run
  (`pipeline.ts` already guarantees this); this just makes the *issue* not
  multiply across runs.
- `result.errors` empty and the issue is open: close it with a note that
  the run succeeded cleanly.

This is the same find-or-create-and-update-or-close shape as
`.github/workflows/links.yml`, just invoked from `github-client.ts` instead
of `actions/github-script`, because this job runs on the VDS, not in a
GitHub Action.

## Security and ops

Matches `docs/discovery-agent.md`'s security model:

- A new **`Dockerfile`** (non-root user, only the vars from *Config and
  caps* plus the existing pipeline ones passed in at `docker run` time, no
  other credentials baked into or reachable from the image) is the
  deployment artifact for the VDS cron job.
- `docs/discovery-agent.md` gets a short new section documenting the cron
  invocation (`docker run --env-file ... discovery-agent`) and the
  credential handling that stays operational, not code: registering the
  LLM API key's spending cap in the provider console, and minting the
  fine-grained `GITHUB_TOKEN` (contents + pull-requests write only, no
  merge, no admin) — both already listed as human-only steps in the same
  document's *Security model* section.
- No IMAP/mailbox credentials are introduced here — out of scope, per
  *Scope* above.

## Testing

Same per-module `.test.ts` + `tests/discovery/fixtures/` convention as the
rest of the discovery agent; nothing calls a real API in CI, everything
stubs `fetchImpl`.

- **`github-client.test.ts`**: branch-create, file create/update, PR-open,
  label-add, and the issue find-or-create-or-close logic, against a
  stubbed `fetch`.
- **`orchestrator.test.ts`**, the core of this design's coverage:
  - end-to-end candidate → PR, with stubbed `classifyCandidate` and
    `github-client`
  - idempotence: identical run twice ⇒ second run opens no PR
  - rerun with changed candidate content ⇒ updates the existing open PR's
    branch and body, no duplicate
  - rerun where the branch's PR was since merged or closed ⇒ silently
    skipped, no new branch
  - `MAX_PRS` reached mid-run ⇒ remaining `add` candidates logged as
    skipped, no further GitHub writes
  - `MAX_TOKENS` exceeded mid-run ⇒ remaining work stops; already-opened
    PRs from earlier in the run are untouched
  - a source failure ⇒ tracking issue created; same failure next run ⇒
    issue updated, not duplicated; a subsequent clean run ⇒ issue closed
- **`run-cli.test.ts`**: config validation (missing `GITHUB_TOKEN` /
  `GITHUB_REPO` / invalid `MAX_TOKENS` / `MAX_PRS` each fail fast), same
  style as `parse-sources-cli.test.ts`.

Adversarial-input coverage (prompt-injection pages, malformed dates,
missing fields) already exists at the extraction and classification layers
(`tests/discovery/fixtures/candidates/adversarial.yaml`, and the extraction
fixtures) and needs nothing new here — the orchestrator only ever receives
`RawEvent` drafts that have already passed `validateEvent` and
`classifyCandidate`, never raw page or mail text.

## Non-goals

- Publishing anything without human review (unchanged from
  `docs/curation-policy.md`).
- Mailbox/IMAP ingestion (deferred, per *Scope*).
- Consecutive-failure thresholds for the tracking issue — any failure
  triggers the find-or-update, per *Decisions*.
- A Dockerfile does not imply the site's own deployment changes — this
  container is only the discovery-agent cron job, unrelated to the
  Cloudflare Worker that serves the site.
