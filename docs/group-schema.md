The JSON Schema in `schema/group.schema.json` must implement this document exactly.

# Group schema

| Field         | Type     | Required    | Rules                                                                                                                                                                                                    |
| ------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string   | yes         | `^[a-z0-9]+(-[a-z0-9]+)*$`. Equals the file name without `.yaml`. Stable once merged.                                                                                                                    |
| `name`        | string   | yes         | 2–140 characters. The name the group uses on its own site.                                                                                                                                               |
| `aliases`     | string[] | no          | Other names seen in event or position data, 2–140 characters each, unique. Used for matching.                                                                                                            |
| `kind`        | enum     | yes         | `group`, `institute`, `network`, `society`.                                                                                                                                                              |
| `pi`          | string   | no          | Head or PI in full, given and family name (joint heads joined by "and" or commas), 2–140 characters. Allowed only when `kind` is `group`.                                                                |
| `parent`      | string   | no          | Host institution as text, 2–140 characters.                                                                                                                                                              |
| `website`     | string   | yes         | `https://`. Host not on `data/blocklist.yaml`.                                                                                                                                                           |
| `source_url`  | string   | no          | `https://`. The page the fields were taken from, when it is not `website`. Host not blocklisted.                                                                                                         |
| `location`    | object   | conditional | `city` (1–100 characters, required), `country` (ISO 3166-1 alpha-2, uppercase, required, in `src/lib/regions.ts`). Required when `kind` is `group` or `institute`; optional for `network` and `society`. |
| `topics`      | string[] | yes         | 1–5 unique slugs from `data/topics.yaml`.                                                                                                                                                                |
| `description` | string   | yes         | Own words, plain text, 1–600 characters.                                                                                                                                                                 |
| `added`       | date     | yes         | Date first seen, a real calendar date, not in the future.                                                                                                                                                |
| `fixture`     | boolean  | no          | Development data; excluded from production builds.                                                                                                                                                       |

Unknown fields are errors.

## Validation rules

In `src/lib/group-validation.ts`, run by `npm run validate` and the build:

- The id equals the file name.
- `added` is a real date and not in the future.
- Every topic is in the vocabulary; the country is in the region table.
- `website` and `source_url` are https and their hosts are not blocklisted.
- `pi` only on `kind: group`; `location` present on `group` and `institute`.
- `pi` names each head in full: "Sam", "Prof. Shinoda" or "Jeschke and Otsuki" fail (`isFullPersonName`).
- No duplicate id.
- No duplicate `website` (compared after lowercasing the host and dropping a trailing slash).
- No name or alias shared by two entries, compared after normalisation (`normaliseGroupName`: lowercase, strip punctuation and diacritics, collapse whitespace). A name may not equal its own alias.
- Warning: a description over 200 characters with no full stop looks copied.
