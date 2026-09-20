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

## 2026-09-20 — Repository default branch is `master`, not `main`

The task brief and its CI workflow (`.github/workflows/ci.yml`, `push:
branches: [main]`) assume the default branch is `main`. The actual local
repository default branch is `master`. The CI workflow content is kept
verbatim from the plan (`branches: [main]`) rather than silently rewritten to
`master`, since renaming the default branch — or retargeting CI — is a
one-line call for the maintainer to make once a GitHub remote exists, and
guessing wrong here is cheap to get wrong twice. Flagged for the maintainer to
resolve before first push: either rename the default branch to `main` or
change the workflow's `branches` list to `master`.

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
