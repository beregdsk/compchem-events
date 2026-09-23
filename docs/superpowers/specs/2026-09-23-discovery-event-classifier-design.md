# Discovery agent: candidate event classifier

Written: 2026-09-23

## Status

Sub-project of the phase 5 discovery agent (`docs/discovery-agent.md`). That
document is specification only; no discovery-agent code exists in this repo
yet, so this piece is built and tested standalone, ahead of the fetch,
extract, and PR-opening steps around it.

## Purpose

Given one candidate event, already shaped like the event schema, decide
whether it is worth opening a pull request for (`add`) or not (`skip`), per
the discovery-agent pipeline's steps 6 (deduplicate) and 7 (screen). This
never publishes anything. It produces a verdict for a future PR-opening step
to act on; `docs/curation-policy.md` already states that automatically
discovered events are never published without human review, and this design
does not change that.

## Scope

**In scope:** a classification function, a CLI wrapper to run it standalone,
and its tests.

**Out of scope (separate, later tasks):** fetching sources, extracting
structured fields from raw pages or mail, opening the pull request, the
`needs-review` PR template, and the mailbox/IMAP source. This design assumes
a candidate event has already been extracted into (most of) the schema
shape described in `docs/data-schema.md` — it does not extract anything
from raw text itself.

## Model

[jev](https://openrouter.ai/docs/guides/community/jev) (`typesafe/jev-*` on
OpenRouter) is a decision model, not a chat model: it takes a `state` object
plus one or more typed questions and returns typed answers with
probabilities — never generated text or a reasoning trace. Three question
types exist: `noul` (yes/no, returns a probability), `choice`, and `score`.
This design only uses `noul`.

Because it never generates free text, a candidate's content can only ever
occupy the `state` field of a request, never `instructions` or `criteria`
(those come from this codebase). A scraped page or forwarded email is
hostile input by the same reasoning `docs/discovery-agent.md` already
applies to the extraction step; routing it only into `state` means the
model has no channel through which injected text could change which
question is asked or how it's scored.

Model id: `~typesafe/jev-latest` (tracks the newest release; a silent
version bump could shift verdicts on re-run candidates, an accepted
tradeoff for staying current).

## Architecture

- `src/lib/discovery/classify-candidate.ts` — `classifyCandidate()`, the
  function described below. No I/O beyond the one HTTP call to OpenRouter;
  takes the candidate, the current events list, and the blocklist as plain
  arguments so it's easy to test and to call from a future pipeline.
- `scripts/discovery/classify.ts` — CLI: reads a candidate YAML/JSON file
  path from argv, loads `data/events/` (via the existing loader in
  `src/lib/events.ts`) and `data/blocklist.yaml`, calls
  `classifyCandidate()`, prints the result as JSON to stdout.
- `tests/discovery/classify-candidate.test.ts` and
  `tests/discovery/fixtures/` — see Testing below.

## Data flow

### 1. Mechanical pre-filter (no LLM call)

Runs before anything is sent to jev, so obvious cases cost nothing:

- Candidate `url` matches an existing event's `url` → skip,
  `mechanicalReason: "duplicate-url"`.
- Candidate `title` (normalized: lowercased, whitespace-collapsed) and
  `start_date` match an existing event → skip,
  `mechanicalReason: "duplicate-title-date"`.
- Fuzzy title match (string-similarity threshold, exact function TBD in
  implementation) against an existing event on the same `start_date` →
  skip, `mechanicalReason: "duplicate-fuzzy"`.
- Candidate's `url` or `organizer` host matches an entry (or subdomain of
  an entry) in `data/blocklist.yaml` → skip,
  `mechanicalReason: "blocklisted"`.

Any mechanical skip returns immediately with no jev call and no cost.

### 2. jev classification

One request to the OpenRouter Decisions API (`POST
https://openrouter.ai/api/alpha/decisions`), four `noul` questions in the
same call:

| Key | Question | Grounded in |
|---|---|---|
| `add` | Should this candidate be added to the calendar? | Overall verdict |
| `relevant` | Is the event's main subject computational or theoretical chemistry, per the listed scope? | `curation-policy.md` "What we list" |
| `credible` | Does it have an identifiable official organiser/committee, a scientific programme, and transparent costs? | `curation-policy.md` "Inclusion criteria" |
| `red_flag` | Does it show promotional or predatory signals (unsolicited invitation-style promotion, guaranteed acceptance, pressure to pay quickly, unverifiable claims)? | `curation-policy.md` "Reasons we decline" |

`state` carries the candidate's `title`, `start_date`, `end_date`, `format`,
`location`, `url`, `organizer`, `topics`, and `description` — the fields a
reviewer would look at, nothing else. `instructions` and `criteria` text
for all four questions is fixed in code, built from the policy language
above.

### 3. Result

```ts
type ClassificationResult =
  | { verdict: "skip"; mechanicalReason: string }
  | {
      verdict: "add" | "skip";
      confidence: number; // the `add` noul probability
      criteria: { relevant: number; credible: number; red_flag: number };
    };
```

`verdict` is `"add"` when `confidence >= ADD_THRESHOLD` (default `0.5`, one
named constant). An `"add"` verdict means "worth opening a PR for a human
to review" — never "publish."

## Configuration

Reuses the environment variables `docs/discovery-agent.md` already
specifies, so the future pipeline shares config with this piece:

- `LLM_API_KEY` — required. Fail fast with a clear error message if unset.
- `LLM_BASE_URL` — default `https://openrouter.ai/api/alpha/decisions`.
- `LLM_MODEL` — default `~typesafe/jev-latest`.

The key is never hardcoded and never committed. Per
`docs/discovery-agent.md`'s security model, it must carry a spending cap
set in the provider console — that's a human-only step, noted here so it
isn't lost before the pipeline that actually runs unattended exists.

## Error handling

A failed jev call (network error, non-2xx response, malformed response
body) throws from `classifyCandidate()`. The CLI catches it, prints the
message to stderr, and exits non-zero. No retry logic: nothing calls this
function in an unattended loop until the fetch/PR pipeline exists, and
that pipeline's own failure handling (log and continue past one bad
source) is out of scope here.

## Testing

Following the testing approach `docs/discovery-agent.md` already specifies
for the wider agent:

- `tests/discovery/fixtures/` holds candidate fixtures covering: a clean
  add, an exact URL duplicate, a title+date duplicate, a fuzzy-title
  duplicate, a blocklisted domain, and an adversarial fixture with
  prompt-injection-style text in `description`.
- The jev HTTP call is stubbed in tests with canned responses. CI never
  calls the real API.
- Assert mechanically-skipped fixtures never reach the stub at all (call
  count stays zero).
- Assert the adversarial fixture is classified on its actual content, not
  redirected by the injected text.

## Open follow-ups (not this task)

- Wiring `classifyCandidate()` into the actual fetch → extract → classify →
  PR pipeline.
- The fuzzy-title-match algorithm's exact threshold and library choice.
- Deciding what happens to `red_flag`-high but `add`-verdict candidates in
  the eventual PR body/template (this design only produces the number; the
  PR-opening step, not yet built, decides how to present it).
