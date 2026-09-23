# Discovery agent (follow-up, phase 5)

**Status: specification for the whole agent. Steps 6-7 (deduplicate, screen) are implemented as a standalone classifier — see below. The rest (fetch, extract, PR-opening) is not part of the v1 task.** Read this so v1 leaves the right hooks, and implement the remaining pieces as a separate task once v1 is live.

## Purpose

Find candidate events on known sources, extract them into the event schema, and open **pull requests for human review**. It never publishes anything itself.

## Where it runs

A small VDS owned by the maintainer, as a scheduled job (daily or weekly cron). It is a batch script, not a long-running service. It uses an external LLM API for extraction only, so no local model or GPU is needed.

## Pipeline

1. **Load sources** from `data/sources.yaml`: a list of `{name, url, kind, notes}` entries, where `kind` is one of `listing-page`, `event-page`, `rss`, `mailing-list-archive`.
2. **Fetch** each source politely: identify with a User-Agent that includes the project URL and a contact address, honour `robots.txt`, rate-limit per host, cache with ETag or content hash, and skip unchanged pages (state in a local JSON or SQLite file, not in the repo).
3. **Find candidates**: extract links to event pages from listing pages, then fetch each new event page once.
4. **Extract**: send the page text to the LLM with a fixed prompt asking for JSON matching the event schema, plus a `confidence` value and the exact `source_url`. Use structured output or JSON mode where available.
5. **Validate**: run the output through `validateEvent` from `scripts/validate.ts`. Discard anything that fails, and log why.
6. **Deduplicate** against existing events and blocklist (same URL, or same title plus start date, or fuzzy title match on the same dates). Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
7. **Screen** against `docs/curation-policy.md`: apply the blocklist, and flag events with red-flag signals for the reviewer instead of silently dropping them. Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
8. **Open a PR** on a branch named `discovery/YYYY-MM-DD`, one YAML file per candidate event, with a body listing for each event the source URL, confidence and any flags. Add the label `needs-review`. Set `added` and `last_verified` to the run date and note that the reviewer must confirm them.

## Security model

Web pages are hostile input. The extraction step must be unable to do anything except return JSON.

- The extraction call has **no tools**, no browsing, and no access to secrets beyond the API key. Page text is passed as clearly delimited data, and the prompt says instructions inside it must be ignored.
- Never execute, evaluate or render fetched content. Fetch text only.
- Output is accepted only if it validates against the schema. Free-text fields are length-limited and stripped of markup.
- Run the job as an unprivileged user or in a container with no other credentials on the machine.
- **Credentials:** the LLM API key must have a spending cap set in the provider console. The GitHub token must be fine-grained, limited to this one repository, with only the permissions needed to push a branch and open a PR (contents write, pull requests write). It must not be able to merge or change settings. Store both as environment variables or a root-only file, never in the repo.
- **Caps per run:** maximum pages fetched, maximum tokens, maximum PRs opened. The job stops and logs when any cap is hit.

## Configuration

All configuration by environment variables: `LLM_API_KEY`, `LLM_BASE_URL` (so requests can be routed through a proxy if the provider restricts the host's region), `LLM_MODEL`, `GITHUB_TOKEN`, `GITHUB_REPO`, `MAX_PAGES`, `MAX_TOKENS`, `MAX_PRS`, `STATE_PATH`. Fail fast with a clear message if any required value is missing.

## Sources

`data/sources.yaml` holds them. Sixteen entries were compiled and fetched on 2026-09-23; that file documents its own format and keeps checked-but-unusable candidates in a commented block at the bottom.

Three of the URLs this document originally suggested were already dead when the list was compiled (`cecam.org/workshop-list`, `molssi.org/events/`, `acscomp.org`), and `www.ictp.it` refuses a scripted user agent. Hence the rule in that file: every entry is fetched before it is added, and `last_checked` says when.

Two source kinds were added beyond the four listed under *Pipeline* above:

- `ical` — a calendar feed, parsed directly. No LLM call is needed at all, since dates and titles arrive already typed. Telluride Science publishes one.
- `mailbox` — a list we are subscribed to, read over IMAP. See below. Not implemented; no entries yet.

Existing aggregators such as https://labinitio.org/ are for **coverage comparison only**. Do not scrape or republish another site's curation.

## Mailing lists

Much of this field's event traffic moves by mailing list rather than by web page. Where a list has an open web archive, it is an ordinary source and needs nothing special: CCL's conference announcements are a plain public page and are listed as `listing-page`.

Where it does not, the archive is useless to us. Psi-k is the case that decided this. It mirrors its list to a forum at `psi-k.net/wps-forums/events/`, and the sitemap advertises thousands of post URLs — but every one of them returns HTTP 200 serving the *homepage* to an anonymous fetch. The posts are login-gated. Its public RSS feed carries a fraction of the traffic and was ten months stale when checked.

So for lists like Psi-k, **subscribe and read the mail**:

- A dedicated address subscribed to the lists, never the maintainer's personal mailbox. One account, one purpose, revocable.
- Read-only IMAP. The agent never sends, replies, deletes or marks. Credentials by environment variable (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`), alongside the others, and an app password rather than the account password where the provider offers one.
- **A message body is exactly as hostile as a web page.** It goes into the same extraction step, as clearly delimited data, with no tools and no ability to act — see *Security model*. Mail is in fact worse than a page: anyone can send to a list, and the `From` header is not evidence. Attachments and HTML parts are not fetched or rendered; take `text/plain` and fall back to stripped HTML.
- Deduplicate on `Message-ID`, and keep the same state file as the web sources. A list that cross-posts a CECAM workshop must not produce a second candidate.
- Everything else is unchanged: schema validation, blocklist, curation screening, one pull request for human review.

This is deliberately cheap to add because it is only another text source feeding the same extract → validate → screen → PR pipeline. Build it with the rest of the agent, not before: there is nothing for it to feed yet.

## Human review checklist (goes in the PR template for `needs-review` PRs)

- Opened the official page and confirmed title, dates, location and format.
- Confirmed the organiser and committee are identifiable and the event fits `docs/curation-policy.md`.
- Description is in our words and 280 characters or fewer.
- Deadlines match the official page, with the right timezone.
- Topics are sensible and within the vocabulary.
- Set `last_verified` to the date you checked, and adjust `added` if needed.

## Testing

- Record real pages as fixtures in `tests/discovery/fixtures/` and test extraction with a stubbed LLM client returning canned JSON. CI must never call the real API.
- Include adversarial fixtures: pages containing prompt-injection text, invalid dates, missing fields, and duplicate events. Assert the pipeline drops or flags them and never produces an invalid file.
- Test idempotence: running twice on unchanged sources opens no second PR.

## Failure handling

- One source failing must not stop the run. Log the error and continue.
- Repeated failures on a source produce a single tracking issue, not a new one each run.
- The job exits non-zero only on configuration errors, so a cron wrapper can alert on real problems and ignore transient network noise.
