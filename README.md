# CompChem Events

A community-maintained calendar of conferences, workshops and schools in computational and theoretical chemistry: electronic structure, molecular simulation, ML for chemistry and materials, computational materials science and computational drug design.

Events are listed with topics, location, format and deadlines, and can be filtered and exported to your calendar. Listings are curated: see the [curation policy](docs/curation-policy.md).

> **Status:** v1, phases 0-4. The discovery agent (phase 5) is tracked in [`TASK.md`](TASK.md) and specified in [`docs/discovery-agent.md`](docs/discovery-agent.md).

## How it works

- Each event is a YAML file in [`data/events/`](data/events/), validated against [`schema/event.schema.json`](schema/event.schema.json).
- The site is built with Astro into static files and hosted on Cloudflare (a git-connected Worker serving static assets — see `wrangler.jsonc`). There is no server or database.
- Feeds: `/events.ics`, `/deadlines.ics`, `/feed.xml` and `/events.json`.
- Anyone can add or correct an event with a pull request or an issue. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Local development

Requires the Node version in `.nvmrc`.

```
npm ci
npm run dev          # local dev server at http://localhost:4321
npm run validate     # schema and semantic checks on all event data
npm run lint         # eslint + prettier
npm run typecheck    # astro check
npm test             # vitest
npm run build        # production build into dist/ (fails on invalid data)
npm run preview      # serve the production build
npm run test:e2e     # Playwright smoke test, against a production build (run `npm run build` first;
                     #   one-time setup: npx playwright install --with-deps chromium)
npm run check-links  # fetch every event's url/source_url and report the dead ones (never fails)
```

## Documentation

- [Repository map](METADATA.md) — what every file and folder is for
- [Data schema](docs/data-schema.md)
- [Curation policy](docs/curation-policy.md)
- [Discovery agent spec](docs/discovery-agent.md) (planned follow-up)
- [Decision log](docs/decisions.md)
- [Rules for coding agents](AGENTS.md)

## Licence

Code is [MIT](LICENSE). Event data in `data/` is [CC0 1.0](data/LICENSE) (public domain).
