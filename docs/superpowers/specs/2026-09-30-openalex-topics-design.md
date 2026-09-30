# OpenAlex topics and topic statistics — design

Date: 2026-09-30. Status: design agreed in conversation 2026-09-30; this
written spec awaits the maintainer's review.

## Intent

A literature view of every site topic: how many papers it produces a year,
where they come from, where they are published, and which recent ones are
most cited, next to what this site itself lists for the topic. And a much
larger, mapped topic vocabulary underneath the site's broad topics, taken
from OpenAlex, so both the statistics and later work (the groups crawler's
seeds) rest on the same, reviewable mapping.

This is sub-project 6 of the coverage work agreed on 2026-09-30:

1. crawler core, 2. groups at scale, 3. new event sources,
4. a resources registry (software, databases and datasets, courses),
5. discovery for that registry, 6. OpenAlex topics and statistics.

The maintainer chose to build 6 first. Sub-projects 1 and 2 have an agreed,
parked design (sections 1–2 approved) and get their own spec next; they will
seed the crawl from this sub-project's institution rankings.

Agreed with the maintainer:

- **Two levels.** The site keeps about 20 broad topics (`data/topics.yaml`)
  as its filters and tags. Each maps to a set of OpenAlex topics underneath.
  Events, groups and positions keep their broad tags; nothing is re-tagged.
- **Reviewed mapping, monthly snapshot.** A script proposes the mapping as a
  PR the maintainer reviews. A monthly job commits the statistics as a data
  file through a PR. The site stays static and renders that file.
- **Statistics per topic:** papers over time; top institutions; top venues
  and most-cited recent papers; this site's own coverage (upcoming events,
  groups, open positions).

## Constraints from the repo

- AGENTS.md rule 3: static site. Nothing on the site queries OpenAlex at
  view time; the build reads `data/topic-stats.json`.
- Rule 6: a new data contract ships a JSON Schema, a schema doc, a
  validator, fixtures, tests and a `docs/decisions.md` entry.
- Rule 7: fetched data is untrusted. OpenAlex titles and names are rendered
  as text; the one model call has no tools and receives topic names as
  delimited data.
- Rule 9: Conventional Commits, a branch per change, never push to `main`.
- No new npm dependencies (charts are generated SVG).
- `data/topics.yaml` says adding a slug is a schema-level change, reviewed
  with `docs/data-schema.md`; that stays true.

## OpenAlex facts this design relies on

Checked against the live API on 2026-09-30:

- About 4,500 topics in a hierarchy domain › field › subfield › topic. A
  topic has `id` (`T11948`), `display_name`, `description`, `keywords`,
  `subfield`, `field`, `works_count`, `cited_by_count`. **Topics have no
  `counts_by_year`.**
- `works?filter=topics.id:T1|T2,…` ORs topics; a work counted once.
  `group_by=publication_year`, `group_by=authorships.institutions.id` and
  `group_by=primary_location.source.id` return counts per group.
  `primary_location.source.type:journal` drops arXiv, Zenodo and ChemRxiv
  from venue rankings. `sort=cited_by_count:desc` with
  `select=title,doi,cited_by_count,publication_year` gives most-cited works.
- Institutions carry `homepage_url` and `country_code`.
- Pricing: each call costs $0.0001; anonymous use is capped at $0.10/day,
  a free account key at $1/day (header `x-ratelimit-limit-usd`). The key is
  sent as `api_key=`. Data is CC0.

Citations per year for a set of topics are not available in a cheap query
(group_by counts works, it does not sum citations). The design therefore
shows **papers per year** as the trend and **total citations** as a number,
not citations per year. Slug-level citations are the sum of the mapped
topics' `cited_by_count`, which counts a paper tagged with two of the
slug's topics twice; the page says so ("citations to papers in these
topics"). Per-OpenAlex-topic citations are exact.

## Data model

### `data/topics.yaml` (existing, extended)

Each entry gains an optional `openalex` list:

```yaml
- slug: ml-potentials
  label: Machine-learned potentials
  openalex: [T11948, T10762]
```

- Ids match `^T\d+$`, unique within an entry.
- The same OpenAlex topic under two slugs is allowed (a warning, not an
  error): "Machine Learning in Materials Science" can belong to both
  `ml-potentials` and `materials-modeling`.
- An entry without `openalex` has no statistics; its pages render as today.
- The loader (`loadTopics` in `src/lib/validation.ts`) returns the field;
  nothing else reads it except the snapshot job and the topic pages.

### `data/topic-stats.json` (new, generated)

Written only by the snapshot job; never edited by hand.

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-10-02",
  "source": "OpenAlex",
  "topics": {
    "ml-potentials": {
      "openalex": ["T11948", "T10762"],
      "works_by_year": [{ "year": 2012, "works": 812 }, …],   // 15 full years, oldest first
      "works_total": 164000,
      "growth_5y": 1.84,            // works in last full year / works five years before
      "citations_total": 1450000,   // sum over mapped topics, see above
      "top_institutions": [          // last three full years, up to 10
        { "id": "I27837315", "name": "University of Michigan", "country": "US",
          "homepage": "https://www.umich.edu", "works": 212 }
      ],
      "top_venues": [ { "id": "S…", "name": "Journal of Chemical Theory and Computation", "works": 640 } ],
      "top_papers": [                // last three full years, 5, most cited
        { "title": "…", "year": 2024, "doi": "https://doi.org/10…", "citations": 1794 }
      ],
      "subtopics": [ { "id": "T11948", "name": "Machine Learning in Materials Science",
                       "works": 120409, "citations": 1102096 } ]
    }
  }
}
```

"Full years" are years before the snapshot's year: the current year is
always partial and would read as a false decline.

### Validation (`npm run validate`)

- `schema/topic-stats.schema.json` (Ajv 2020) checks the file's shape.
- `validateTopicStats` also checks: every key is a slug in `topics.yaml`;
  its `openalex` list equals that slug's current mapping (a stale snapshot
  after a mapping change is a warning, not an error, so a mapping PR can
  merge before the next snapshot); every `doi` and `homepage` is `https:`;
  years are consecutive.
- A missing `data/topic-stats.json` is valid (fresh checkout, empty state).
- `topics.yaml` `openalex` ids are checked as above.

## Proposing the mapping (`scripts/topics/propose-map.ts`)

Run by hand, re-runnable; opens or updates one PR on
`data/topic-map`.

1. **Candidates.** Every OpenAlex topic in these subfields: all of field 16
   Chemistry (1602–1607); Materials Science 2500, 2504, 2505, 2508;
   Physics 3104 Condensed Matter, 3107 Atomic and Molecular Physics and
   Optics, 3109 Statistical and Nonlinear Physics; 1303 Biochemistry,
   1304 Biophysics, 1315 Structural Biology; 1702 Artificial Intelligence,
   1703 Computational Theory and Mathematics, 1706 Computer Science
   Applications; 3002 Drug Discovery, 3003 Pharmaceutical Science. Paged,
   `select=id,display_name,description,keywords,subfield,works_count`.
2. **Keyword rules** (`src/lib/topics/map-rules.ts`): a small table from
   phrases to slugs, matched against name, description and keywords —
   e.g. *density functional*, *DFT* → `dft`; *molecular dynamics* →
   `molecular-dynamics`; *machine learning* with *potential* or *force
   field* → `ml-potentials`. A topic may match several slugs.
3. **Model** for the rest, in batches of 50, no tools, topic text as
   delimited data: each topic gets zero or more slugs from the vocabulary,
   or `not-compchem` (experimental-only chemistry, clinical pharmacology,
   general AI). The model never sees or returns anything but topic ids from
   the batch and slugs from the vocabulary; anything else is dropped.
4. **PR body:** per slug, a table of assigned topics (id, name, subfield,
   works, "rule" or "model"); then **"Relevant, no slug"** — topics the
   model called compchem but could not place, sorted by works — which is
   how a missing broad topic surfaces. Adding a slug stays the maintainer's
   decision, made by editing the PR.

The file change is only the `openalex:` lists in `data/topics.yaml`,
written in place (comments and order preserved by editing the YAML
document, not re-serialising it).

## The snapshot job (`scripts/topics/snapshot.ts`)

For each slug with a mapping, with `F = topics.id:<ids joined by |>`:

| Query | Gives |
| --- | --- |
| `works?filter=F,publication_year:Y-15..Y-1&group_by=publication_year` | `works_by_year` |
| `works?filter=F&per-page=1` (meta count) | `works_total` |
| `works?filter=F,publication_year:Y-3..Y-1&group_by=authorships.institutions.id` | institution ids, counts |
| `institutions?filter=openalex:I1\|I2…&select=id,display_name,country_code,homepage_url` | names, homepages |
| `works?filter=F,publication_year:Y-3..Y-1,primary_location.source.type:journal&group_by=primary_location.source.id` | `top_venues` |
| `works?filter=F,publication_year:Y-3..Y-1&sort=cited_by_count:desc&per-page=5&select=…` | `top_papers` |
| `topics?filter=openalex:T1\|T2…&select=id,display_name,works_count,cited_by_count` | `subtopics`, `citations_total` |

About 7 calls per slug, ~150 a month: $0.015, inside the free key's $1/day.

- `OPENALEX_API_KEY` (optional; anonymous works, with the lower cap) and a
  `mailto` of the site's contact address on every request.
- Retries 429 and 5xx up to three times with backoff (`Retry-After`
  honoured); any other failure, or any slug still failing, **abandons the
  whole snapshot**: last month's file stays, and nothing partial is
  committed.
- Output is validated against the schema before it is proposed.
- Proposes via the existing `Proposer` on branch
  `data/topic-stats-YYYY-MM`, labels `data`; the maintainer merges. Numbers
  are rounded as stored; the PR body is a short table of works last year
  and five-year growth per slug, with changes from the previous snapshot.

### Where it runs

The discovery host (`~/discovery-agent/`), like the nightly agent:

- `topic-stats.sh`: sources `.env`, runs the script from the `/home/egor/agg`
  checkout, logs to `topic-stats.log`.
- Crontab: `17 4 2 * *` (the 2nd of each month, 04:17 local), clear of the
  23:54 nightly run.
- `.env` gains `OPENALEX_API_KEY` (set 2026-09-30).
- A failed run opens or updates its own issue (label
  `topic-stats-failures`); a good month closes it. Amended 2026-09-30 after
  review: sharing `discovery-failures` let the nightly run overwrite and
  close the report within a day.

## The pages

### `/topics/` (existing, extended)

One row per slug: label (link), papers last full year, five-year growth,
a 15-year sparkline (inline SVG, ~80×20), citations, and this site's
upcoming events, groups and open positions. Default order: papers last
year, descending. A few lines of progressive-enhancement JS make the column
headers sort; without JS the table is in the default order and fully
readable. Slugs without statistics show "—" and sort last.

### `/topics/<slug>/` (existing, extended)

Above the existing event list, a statistics block:

- A 15-year chart of papers per year (inline SVG from
  `src/lib/charts.ts`, axis labels as text, a `<title>` and a data table
  alternative for screen readers).
- Totals: papers, citations (with the "counted per topic" note), growth.
- Top institutions (name, country; linked to the homepage when `https:`),
  top venues, most-cited papers (linked to the DOI).
- OpenAlex topics under this slug, with works and citations, each linked to
  its OpenAlex page.
- This site's coverage: counts of upcoming events, groups and open
  positions with this topic, linking to the filtered lists.
- Attribution: "Literature data: OpenAlex (CC0), snapshot of <date>."

Styling uses the site's existing tokens and both themes. With no snapshot,
the block is absent and the page is as today.

## Security

- OpenAlex strings (titles, names, venues) are rendered as text by Astro's
  escaping; they never reach `set:html`. URLs are rendered only when
  `https:`; otherwise the name is shown unlinked.
- The mapping script's model call has no tools; topic text is delimited
  data; its answer is filtered to known ids and slugs.
- The API key lives only in `~/discovery-agent/.env` (mode 600), is sent
  only to `api.openalex.org`, and never appears in logs, PR bodies or the
  repository.

## Failure handling

- Snapshot: all or nothing, as above; the previous month's data stays live.
- Mapping script: run by hand; it fails loudly and writes nothing on error.
- Build: a missing or older snapshot never fails the build; a malformed one
  fails `npm run validate` in CI, so it cannot merge.

## Testing

- Unit: query building (filters, year ranges, id joining); parsing recorded
  OpenAlex responses (fixtures under `tests/topics/fixtures/`) into the
  snapshot shape; the full-years rule; `growth_5y`; all-or-nothing on one
  failing slug; retry on 429 with `Retry-After`.
- Mapping: keyword rules; filtering of the model's answer to known ids and
  slugs; in-place YAML edit keeps comments and order.
- Validator: good and bad snapshot fixtures; stale-mapping warning;
  non-https URLs; missing file is valid.
- Charts: SVG for a normal series, a flat series, an empty series.
- E2E: `/topics/` and one topic page with a fixture snapshot and without
  one; column sorting with JS, default order without.

## Documentation

- `docs/topic-stats.md`: the snapshot's schema and meaning of each field,
  including the citations caveat.
- `docs/data-schema.md`: the `openalex` field on topics.
- `docs/decisions.md`: OpenAlex as a data source; two-level topics; papers
  per year rather than citations per year, and why.
- `docs/discovery-agent.md` *Deployment*: the monthly cron and the env var.
- `README.md` and `METADATA.md`: the two scripts and the new files.

## Delivery order

1. `openalex` field on topics, validator, loader; `topic-stats` schema,
   validator, fixtures (no data yet).
2. OpenAlex client (`src/lib/topics/openalex.ts`) and the snapshot script,
   tested on fixtures.
3. Mapping script; run it; the mapping PR for the maintainer.
4. Charts and the two pages, on fixture data.
5. First real snapshot PR; the monthly cron on the host.

## Out of scope

- Re-tagging events, groups or positions with OpenAlex topics.
- Citations per year, per-author statistics, per-country maps.
- The groups crawler (sub-projects 1–2), which will read
  `top_institutions` as seeds.
