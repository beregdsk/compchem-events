# CompChem Events

A community-maintained calendar of conferences, workshops and schools in computational and theoretical chemistry: electronic structure, molecular simulation, ML for chemistry and materials, computational materials science and computational drug design.

Events are listed with topics, location, format and deadlines, and can be filtered and exported to your calendar. Listings are curated: see the [curation policy](docs/curation-policy.md).

> **Status:** v1 (phases 0-3). Phase 4 and the discovery agent are tracked in [`TASK.md`](TASK.md).

## How it works

- Each event is a YAML file in [`data/events/`](data/events/), validated against [`schema/event.schema.json`](schema/event.schema.json).
- The site is built with Astro into static files and hosted on Cloudflare Pages. There is no server or database.
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
```

## Documentation

- [Data schema](docs/data-schema.md)
- [Curation policy](docs/curation-policy.md)
- [Discovery agent spec](docs/discovery-agent.md) (planned follow-up)
- [Decision log](docs/decisions.md)
- [Rules for coding agents](AGENTS.md)

## Licence

To be decided by the maintainer. Suggested: MIT for code and CC0 or CC BY 4.0 for the event data.
