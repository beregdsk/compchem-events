# CompChem Observer

A community-maintained calendar of conferences, workshops and schools in computational and theoretical chemistry: electronic structure, molecular simulation, ML for chemistry and materials, computational materials science and computational drug design.

Events are listed with topics, location, format and deadlines, and can be filtered and exported to your calendar. Listings are curated: see the [curation policy](docs/curation-policy.md).

> **Status:** phases 0-5 are built. The discovery agent (phase 5) runs on a schedule and opens pull requests for human review; see [`docs/discovery-agent.md`](docs/discovery-agent.md).

## How it works

- Each event is a YAML file in [`data/events/`](data/events/), validated against [`schema/event.schema.json`](schema/event.schema.json).
- The site is built with Astro into static files and hosted on Cloudflare (a git-connected Worker serving static assets — see `wrangler.jsonc`). There is no server or database.
- Feeds: `/events.ics`, `/deadlines.ics`, `/feed.xml` and `/events.json`, plus a calendar and Atom feed per topic (`/topics/<slug>.ics`, `/topics/<slug>.xml`) listed on `/topics/`.
- Browsing: every topic has a page at `/topics/<slug>/`, a recurring series with two or more listed editions has one at `/series/<slug>/`, and `/graph/` maps similar events close together.
- A discovery agent finds candidate events on the sources in [`data/sources.yaml`](data/sources.yaml) and opens pull requests. It never publishes; a maintainer merges.
- Anyone can add or correct an event with a pull request or an issue. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Local development

Requires the Node version in `.nvmrc`.

```
npm ci
npm run dev          # local dev server at http://localhost:4321
npm run validate     # schema and semantic checks on all event data, plus data/sources.yaml
npm run lint         # eslint + prettier
npm run typecheck    # astro check
npm test             # vitest
npm run build        # production build into dist/ (fails on invalid data)
npm run preview      # serve the production build
npm run test:e2e     # Playwright smoke test, against a production build (run `npm run build` first;
                     #   one-time setup: npx playwright install --with-deps chromium)
npm run check-links  # fetch every event's url/source_url and report the dead ones (never fails)
npm run discover     # discovery dry run: fetch and extract every source, print candidates (needs LLM_API_KEY,
                     #   LLM_MODEL_EXTRACT, STATE_PATH)
npm run discover:run # the full discovery run that opens pull requests; see docs/discovery-agent.md
```

## Documentation

- [Repository map](METADATA.md) — what every file and folder is for
- [Data schema](docs/data-schema.md)
- [Curation policy](docs/curation-policy.md)
- [Discovery agent](docs/discovery-agent.md)
- [Decision log](docs/decisions.md)
- [Rules for coding agents](AGENTS.md)

## Licence

Code is [MIT](LICENSE). Event data in `data/` is [CC0 1.0](data/LICENSE) (public domain).
