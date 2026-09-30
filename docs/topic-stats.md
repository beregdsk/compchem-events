# Topic statistics (`data/topic-stats.json`)

Literature statistics for each site topic, from [OpenAlex](https://openalex.org/)
(CC0). Written only by `scripts/topics/snapshot.ts`, once a month on the
discovery host, and proposed as a PR on `data/topic-stats-YYYY-MM`; never
edited by hand. Checked by `npm run validate` against
`schema/topic-stats.schema.json` and `validateTopicStats`
(`src/lib/topic-stats.ts`). A missing file is valid: the topic pages then
render without statistics. Design:
`docs/superpowers/specs/2026-09-30-openalex-topics-design.md`.

## Top level

| Field            | Meaning                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `schema_version` | Always `1`.                                                                           |
| `generated_at`   | ISO date the snapshot was taken.                                                      |
| `source`         | Always `"OpenAlex"`.                                                                  |
| `topics`         | One entry per site topic (slug) that has an `openalex` mapping in `data/topics.yaml`. |

## Per topic

Let `F` be `topics.id:` followed by the topic's OpenAlex ids joined with `|`
(OpenAlex ORs them, so a paper is counted once). "Full years" are the 15
years before the snapshot's year: the current year is partial and would read
as a decline. "Recent" is the last three full years.

| Field              | Meaning and source                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openalex`         | The mapping the snapshot used. If it differs from `data/topics.yaml`, validation warns until the next snapshot.                                                                                                                   |
| `works_by_year`    | Papers per full year, oldest first, 15 entries (`works?filter=F,publication_year:…&group_by=publication_year`); missing years are 0.                                                                                              |
| `works_total`      | All papers ever (`works?filter=F`, `meta.count`).                                                                                                                                                                                 |
| `growth_5y`        | Papers in the last full year divided by papers five years before; `null` when that base year had none.                                                                                                                            |
| `citations_total`  | Sum of the mapped topics' `cited_by_count`. **Citations to papers in these topics: a paper filed under two of the slug's topics counts twice.** OpenAlex topics carry no per-year citation counts, so there is no citation trend. |
| `top_institutions` | Up to 10 institutions with the most recent papers (`group_by=authorships.institutions.id`), with name, country and homepage; a homepage that is not `https:` is left out.                                                         |
| `top_venues`       | Up to 10 journals with the most recent papers (`primary_location.source.type:journal`, so arXiv, ChemRxiv and Zenodo are excluded).                                                                                               |
| `top_papers`       | The 5 most cited recent papers; `doi` only when it is an `https:` URL.                                                                                                                                                            |
| `subtopics`        | Each mapped OpenAlex topic with its own papers and citations (exact per topic).                                                                                                                                                   |

OpenAlex text (titles, names) is untrusted and is rendered as text only.
