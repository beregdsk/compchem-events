# Decision log

Short running log: date, decision, reason. Newest last.

## 2026-09-20 — v1 covers phases 0-3 only

Phase 4 (link-check cron, rebuild cron, duplicate-detection CI, issue forms,
Playwright) is deferred. It is infrastructure around a site that does not exist
yet, and several parts cannot be verified until a GitHub repository and a
Cloudflare deploy hook exist. Spec D1.

## 2026-09-20 — System font stack retained; CLAUDE.md typography rule overridden

`CLAUDE.md` instructs against system fonts. `TASK.md` section 4 mandates them.
The maintainer chose the system stack: zero font bytes and absolute privacy
purity outweigh typographic range here. **Do not reopen this.** Spec D2.

## 2026-09-20 — Seed data is 3 fixtures plus 10-15 verified real events

`TASK.md` asked for 15-30. Every real entry costs a verified page fetch under
AGENTS.md rule 1, and the curation policy holds that a missing listing costs
less than an under-verified one. 10-15 exercises every code path. Spec D3.

## 2026-09-20 — Filters combine OR within a category, AND across categories

`TASK.md` lists the controls but not their combination. This is standard
faceted-search behaviour and the only reading under which "Clear filters" has an
obvious meaning. Spec D4.

## 2026-09-20 — `/events.json` emits `schema_version: 1` from day one

`docs/data-schema.md` promises the field exists for future bumps but omits it
from the example. Emitting it immediately avoids a breaking addition later.
Spec D5.

## 2026-09-20 — `regionOf(country)` stays geographic; `Online` derived in the loader

`docs/data-schema.md` asks one function to depend on both country and format.
Splitting keeps the lookup table testable against ISO codes alone. Spec D6.

## 2026-09-20 — Ratings and reactions deferred, not rejected

Reactions need state outliving a page load, which a static site cannot hold. The
cheapest honest option (Cloudflare Pages Function plus KV) would amend AGENTS.md
rule 3. Ratings additionally collide with the neutrality section of the curation
policy and are statistically meaningless at this site's expected sample size.
Event ids are stable unique keys, so adding reactions later touches only the
event page template and a storage layer. Spec D9.

## 2026-09-20 — Site name is "CompChem Events"

Chosen by the maintainer. The domain is still undecided, so `site.url` stays a
placeholder. Spec section 12 item 1 is half resolved.

## 2026-09-20 — `yaml` chosen over `js-yaml`

js-yaml follows YAML 1.1 and converts bare `YYYY-MM-DD` scalars into JavaScript
`Date` objects in the local timezone, breaking the UTC date invariant at the
parse step. The `yaml` package's default YAML 1.2 core schema leaves them as
strings.

## 2026-09-20 — `.nvmrc` pinned to Node 26, not 24

The plan assumed Node 24. `node --version` on the build machine reported a
26.x runtime, so `.nvmrc` records `26` to match what is actually installed and
what CI's `actions/setup-node` (reading `node-version-file: '.nvmrc'`) will
provision. `package.json` `engines.node` keeps the `>=24` floor from the plan,
which a 26.x runtime still satisfies.

## 2026-09-20 — Installed a newer major of Astro, ESLint, TypeScript and Vitest than the plan assumed

`npm install` with no version pins resolved astro@7, typescript@6, eslint@10
and vitest@5 — all newer majors than the plan's examples anticipated. The
plan's `eslint.config.js`, `astro.config.ts`, `tsconfig.json` and
`vitest.config.ts` contents worked unchanged against these versions (flat
config, `astro/tsconfigs/strict`, and the Vitest `test.include`/`environment`
shape are all still current), so no config-shape adaptation was needed. Noted
here because the plan's dependency-justification text names specific
ecosystem behaviour (e.g. js-yaml vs yaml) that predates these majors; nothing
in that reasoning changes with the newer versions.

## 2026-09-20 — Repository default branch renamed from `master` to `main`

The repository was initialised with `master` as its default branch, which did
not match the plan's merge steps, the design spec, or the already-committed
CI workflow (`.github/workflows/ci.yml`, `push: branches: [main]`) — all of
which name `main`. Rather than retarget the CI workflow to `master`, the
local default branch was renamed to `main` during Task 1, immediately after
this entry was first written. The repository is local-only with no remote
configured, so the rename had no push, PR or collaborator to coordinate
around.

**Closed 2026-09-20.** `git branch -a` lists only `main` and the
`feat/phase-*` branches; no `master` branch exists. `ci.yml`'s
`branches: [main]` has named the correct branch ever since the rename. No
maintainer action is required.

## 2026-09-20 — Three seed events take `location.city` from a CECAM node page, not the event page

`location.city` is required for any event that is not `online`, but three CECAM
event pages state only the node code for their location. The city was read from
CECAM's own node page in each case:

| Event id                                   | Field                     | Secondary page                                                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| `mlip-model-development-applications-2026` | `location.city` = Taipei  | `https://www.cecam.org/cecam-tw` ("Academia Sinica, Taipei, Taiwan")            |
| `computational-electrochemistry-ai-2027`   | `location.city` = Beijing | `https://www.cecam.org/cecam-bj` ("Central location: Beijing, P.R. China")      |
| `fleur-all-electron-dft-tutorial-2027`     | `location.city` = Jülich  | `https://www.cecam.org/cecam-de-juelich` ("Location: Forschungszentrum Jülich") |

`source_url` is deliberately **not** used for these. `docs/data-schema.md`
defines it as the page where the _dates_ were verified; the dates for all three
came from the cited `url`, and a node page supplying a city does not fit that
field's meaning. Recording the second hop here keeps it visible without
stretching the schema. The node pages are on the organiser's own site, so this
is a lookup of what CECAM's own node code denotes rather than an inference.

## 2026-09-20 — MolSSI AI-assisted development workshop considered and declined

The MolSSI "AI-Assisted Development Best Practices" workshop (online,
15-16 October 2026, `https://molssi.org/the-molssi-ai-assisted-development-best-practices-workshop-returns-in-october/`)
was verified and drafted, then removed before release.

`docs/curation-policy.md` scopes listings to events "whose main subject is
computational or theoretical chemistry". This workshop's subject is software
engineering practice — containerised agent execution, requirements-driven
workflows, static and LLM-based code analysis, technical debt. Its organiser and
audience are computational chemists, but the policy's test is the subject of the
event, not the affiliation of the organiser. Listing it would imply that anything
a chemistry-software institute runs qualifies by association. AGENTS.md rule 10
settles the borderline toward fewer listings.

Recorded rather than dropped silently so the call is reversible: if the policy is
later widened to cover research-software practice for the field, this is the
first event to reconsider.

## 2026-09-20 — `/about/` ships without a "Feeds and exports" section

`/events.ics`, `/deadlines.ics`, `/feed.xml` and `/events.json` do not exist yet
(they land in the phase 3 export tasks). Listing them on `/about/` would promise
a feature the site does not have, and this site's value rests on its claims
being reliable, so the section was omitted rather than shipped with dead links.

`Base.astro`'s footer already links three of the same four endpoints
(`/events.ics`, `/feed.xml`, `/events.json`) site-wide, so those links are dead
for the same reason until the same moment: one fact, two symptoms, resolved
together.

Reverse this once phase 3 ships the endpoints: restore the "Feeds and exports"
section on `/about/` listing all four, and the footer's links become live at
the same time.

**Closed 2026-09-21.** Task 16 shipped `/events.ics` and `/deadlines.ics`; this
task ships `/feed.xml` and `/events.json`, the last two of the four. All four
endpoints now exist, so the condition above is met: the "Feeds and exports"
section is restored on `/about/` listing all four, and the footer's
previously-dead `/feed.xml` and `/events.json` links are now live.

## 2026-09-20 — `.prettierignore` excludes pre-existing Markdown docs

The phase-0 tooling scaffold added `.prettierignore` covering `/*.md` and the
pre-existing `docs/curation-policy.md`, `docs/data-schema.md`,
`docs/discovery-agent.md` and `docs/superpowers/` — files that predate this
project's tooling and were not part of that task's file list. Reformatting
them wholesale would be a large, unreviewable diff with no functional benefit;
new docs written by this project (`docs/decisions.md` and code) are still
checked by Prettier. The rationale lived only as a comment inside
`.prettierignore` itself; recorded here per Task 18's sweep for unrecorded
decisions.

## 2026-09-20 — Validation logic lives in `src/lib/validation.ts`; `scripts/validate.ts` re-exports it

`TASK.md` §7 promises the discovery agent (`docs/discovery-agent.md`) a stable
`import { validateEvent }` entry point as a library obligation that outlives
this v1. Putting the schema and semantic checks in `src/lib/validation.ts`
keeps that logic importable and unit-testable without pulling in Node's `fs`
CLI concerns; `scripts/validate.ts` stays a thin CLI wrapper that reads
`data/events/`, calls into `src/lib/validation.ts`, and re-exports
`validateEvent`, `validateCollection`, `loadValidationContext` and their
types, so both `npm run validate` and `import { validateEvent } from
'../scripts/validate'` resolve to the same implementation.

## 2026-09-21 — Countdown island appends beside the server-rendered date

Task 18 adds `src/scripts/countdown.ts`, which finds every
`time[data-countdown]` element and appends a relative-time phrase (`closes in
3 days`, `closes today`, `closed`) as a separate `<span class="countdown">`
after the element, rather than rewriting the `<time>` element's own text. This
follows spec §6 directly: the server-rendered date remains complete and
correct on its own, so a reader with JavaScript disabled loses only the
relative phrase, never the date itself.

## 2026-09-21 — The `/deadlines/` page is removed; deadline data stays everywhere else

The redesign makes the upcoming-events list the whole front of the site, so the
standalone index of deadlines goes. Every other surface that carries deadline
information stays: `/deadlines.ics`, the deadline pill on each event row, the
deadline table on each event page, the countdown island and the "has an open
deadline" filter. No event data and no schema field changed.

## 2026-09-21 — The filter island says "event" directly

`src/scripts/filters.ts` read `data-noun-singular`, `data-noun-plural` and
`data-empty-adjective` off `#result-count` so the `/deadlines/` page could say
"open deadlines". With that page deleted, no caller sets those attributes and
the branch was configuration for a fixed value, so it and its regression test
were removed with the page.

## 2026-09-21 — `/policy/` is merged into `/about/`

With the top navigation bar gone, the footer would otherwise point at two
long-form pages. `docs/curation-policy.md` now renders inside `/about/` and
`/policy/` no longer exists; inbound links became `/about/#curation-policy`.
The markdown file remains the single source of the text.

Its headings were demoted one level in the file itself (`# Curation policy`
became `## Curation policy`) so they nest under the about page's `<h1>`. The
alternative was a build-time heading transform, which Astro 7 only exposes
through the Sätteri processor's `hastPlugins`, requiring an import from a
package the project does not depend on directly. A one-time text edit to the
document costs nothing and keeps `astro.config.ts` empty of pipeline code; the
file still reads correctly on GitHub, starting at a level-two heading. The
anchor is the heading's own generated id, so the page has no duplicate ids.

## 2026-09-21 — Dark-only palette built on the two orbital phase lobes

The 2026-09-20 spec's section 8 specified dark-first with a warm-paper light
mode. The redesign drops the light mode: the site's visual metaphor is a
rendered isosurface on a dark ground, and a second theme that contradicts it
costs more to maintain than it returns. Tokens are now `--lobe-neg` (blue,
aliased as `--link`) and `--lobe-pos` (red, aliased as `--time`), with a new
`--control` token for interactive borders because the old `--rule-strong`
missed WCAG 1.4.11's 3:1 boundary requirement. `tests/styles/contrast.test.ts`
asserts every ratio against the shipped values, so a future colour edit that
breaks AA fails the suite.

## 2026-09-21 — Light theme restored behind a toggle, and a sampled orbital plate

This reverses the dark-only decision recorded above, on the same day, at the
maintainer's request. Two things changed the calculus. The first is reader
control: a theme is not only a house style, and readers who work on paper-white
screens were given no way out. The second is that the argument for dark-only
rested on the metaphor — an isosurface render needs a dark ground — and the
metaphor no longer depends on it.

The background is no longer a stack of radial gradients standing in for an
isosurface. `src/lib/orbital.ts` draws a Monte-Carlo sample of |ψ|² for a real
hydrogenic 3d(z²) orbital, the same construction the poster art this borrows
from uses, and `src/components/OrbitalField.astro` emits it as inline SVG at
build time. Because the dots take their colour from `--lobe-pos` and
`--lobe-neg`, the plate repaints with the theme, which a background image could
not do — that is why it is inline markup rather than a cached asset.

It lives in the masthead rather than behind the whole page, which the browser
decided rather than the plan. Three measured attempts at a full-page wash: thin
enough to sit under the event list, it reads as speckle and not as an orbital;
dense enough to read (9000 dots) it textures the body copy and costs 39 kB
gzipped a page; dense and masked away from the text, it is invisible again. A
whole-page cloud can be legible, quiet or cheap — not all three, because the
listing leaves no empty region for a picture to occupy. The masthead has one.

Two numbers govern how the plate is drawn, and both were wrong in the first
attempt. The sampling ball runs to 20 a₀ so the dusty tail survives, but |ψ|²
peaks at 6 a₀, so scaling the frame to the ball drew the orbital into the
middle third and left it reading as dust; the frame is scaled to a 15 a₀ plot
window instead and samples outside it are dropped, as a plot clipped to its
axes drops them. And stroke widths are viewport-relative: at the plate's scale
the original 1.3–2.6 viewBox units rendered under half a device pixel, so every
dot came out a grey smudge. They are 4.5–9 now. The plate costs about 11 kB
gzipped; 1900 dots saves 3 kB and visibly thins the lobes, so `DOT_COUNT` stays
at 2600.

Tiers are cut against the orbital's global peak density, so the equatorial torus
never reaches the top tier — the axial lobes really are denser, and the render
says so rather than flattering the shape.

The light palette is warm paper (`#f4efe4`), never white, and keeps blue for
links and red for time so the semantics of the two lobes survive the repaint. It
has to be declared twice, once under `prefers-color-scheme: light` and once
under `[data-theme='light']`, because CSS cannot share a block between a media
query and an attribute selector; `tests/styles/contrast.test.ts` asserts the two
copies are identical and checks every WCAG pair in both themes.

The toggle in the masthead writes `localStorage.theme` and is unhidden by
`src/scripts/theme.ts`, so it never appears when it could not work. A small
inline script in `<head>` applies a stored choice before first paint. With
JavaScript off, the system preference still decides.

## 2026-09-23 — Discovery sources verified by fetch; `METADATA.md` owns the layout

`data/sources.yaml` now exists with sixteen entries, each fetched and read
before it was added, per AGENTS.md rule 1. Three URLs suggested in
`docs/discovery-agent.md` were already dead (`cecam.org/workshop-list`,
`molssi.org/events/`, `acscomp.org`) and `www.ictp.it` refuses a scripted user
agent, so a list written from memory would have shipped four broken sources out
of twenty. Checked-but-unusable candidates stay in a commented block in that
file so the finding is not re-derived.

Two source kinds were added to the four the spec listed. `ical` earns its place
because a calendar feed needs no LLM call at all, and `mailbox` because Psi-k
forced the question: it mirrors its mailing list to a forum whose post URLs all
return HTTP 200 serving the homepage to an anonymous fetch, and whose public RSS
was ten months stale when checked. Its traffic is unreachable except by
subscribing. The IMAP path is specified in `docs/discovery-agent.md` and
deliberately not built — the agent it would feed does not exist yet, and mail is
just another text source into the same pipeline.

No validator or CI check for `sources.yaml`. Nothing reads the file yet;
validating it would be scaffolding for an absent consumer.

`METADATA.md` describes every file and folder and is now the single place that
does. The layout block in `AGENTS.md` shrank to a pointer and `README.md` links
it, so the three copies that would have drifted are one.

## 2026-09-23 — Discovery candidate classifier: bigram-Dice fuzzy title match, jev-latest, threshold 0.5

`docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md` left
the fuzzy-title-match algorithm as an open follow-up. It is implemented as a
Sørensen-Dice coefficient over character bigrams of `normaliseTitle()`'s
output (`src/lib/discovery/classify-candidate.ts`, `titleSimilarity()`),
threshold `0.8`: dependency-free, and it reuses the same normalisation
`src/lib/validation.ts` already applies for the build-time exact
title-plus-date duplicate check, so the two dedupe passes cannot disagree
about what "the same title" means.

`normaliseTitle` and `isBlocked` were exported from `src/lib/validation.ts`
(previously private) so the classifier reuses the build validator's own
duplicate-detection and blocklist logic rather than re-implementing it.

jev is called as `~typesafe/jev-latest` rather than a pinned version, per the
design spec. `ADD_THRESHOLD` is `0.5`, a single named constant in
`classify-candidate.ts`, tunable without a design change.

This ships only the classification step, the spec's stated scope. Wiring it
into the fetch/extract/PR pipeline remains a separate, later task.

## 2026-09-23 — Discovery source parsing: `source_url` is never requested from the extraction model

`docs/superpowers/specs/2026-09-23-discovery-source-parsing-design.md`'s
_Extraction_ section listed `source_url` among the fields the LLM's JSON
schema returns, mirroring `docs/discovery-agent.md`'s step 4 wording ("plus
... the exact `source_url`"). The implementation
(`src/lib/discovery/extract-client.ts`) does not ask the model for it: the
pipeline (`src/lib/discovery/pipeline.ts`) already knows, with certainty,
which URL a given extraction input came from — it just fetched it — so
asking the model to reproduce that value would only open a channel for
prompt-injected text to misattribute a candidate's source. `source_url` is
set directly from the fetch, never from model output.

**Amendment (final fix wave):** for `rss`/Atom items specifically, "set
directly from the fetch" is narrower than it sounds: the pipeline never
independently fetches each item's own page, only the feed itself.
`source_url` there is derived from the feed's own per-item `<link>`
(resolved against the feed's URL and validated as http/https, falling back
to the feed's own URL when that resolution fails or isn't http(s) — see
`parseFeedItems` in `src/lib/discovery/parsers/rss.ts`) rather than from an
independent pipeline fetch of that exact URL. This is a narrower provenance
guarantee than for `event-page`/`listing-page`/`ical`/`telegram-channel`,
where `source_url` is always the URL the pipeline itself just fetched —
worth stating accurately rather than overclaiming.

## 2026-09-25 — Rebuild cron implemented (deferred piece of Phase 4)

The GitHub repository and a Cloudflare deploy hook now exist (see the
2026-09-20 "v1 covers phases 0-3 only" entry, which deferred this exact piece
for that reason). Added `.github/workflows/rebuild.yml`: daily cron plus a
manual `workflow_dispatch` (needed to verify the secret and hook actually
work without waiting for the schedule), POSTing to `CF_DEPLOY_HOOK` and
skipping with a log message when that secret is absent. The site's
deployment is a git-connected Cloudflare Worker with static assets (see
`wrangler.jsonc`), not classic Pages; Cloudflare's deploy-hook feature
(originally Pages-only) now covers Workers Builds the same way, so the
mechanism TASK.md specified applies unchanged. The rest of Phase 4
(link-check cron, duplicate-detection CI, issue forms, Playwright smoke
test) remains deferred.
