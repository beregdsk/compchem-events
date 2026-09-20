# Contributing

Thank you for helping keep this calendar accurate. There are three ways to add or fix an event, depending on how much you want to do yourself.

## 1. Pull request (fastest for regular contributors)

1. Fork the repository.
2. Copy an existing file in `data/events/` (or the example in [docs/data-schema.md](docs/data-schema.md)) to `data/events/<start-year>/<id>.yaml`. The `id` is a lowercase slug ending with the year, for example `euchems-compchem-2027`, and must match the file name.
3. Fill in every required field from the **organiser's official page**. Write the description in your own words (280 characters or fewer). Do not copy text from the event site.
4. Set `added` and `last_verified` to today's date. Set `last_verified` only if you actually checked the official page today.
5. Run `npm run validate` and fix any errors.
6. Open a pull request. The template has a short checklist.

## 2. GitHub issue (no coding)

Open the **Event submission** form under *Issues*. Fill in the fields and link to the official page. A maintainer will turn it into a pull request.

## 3. Submission form (no GitHub account needed)

Use the form linked on the site's `/submit/` page. A maintainer will review it and add the event.

## Corrections and reports

- **Wrong date, link or deadline:** use "Suggest a correction" on the event page, or open a **Correction** issue.
- **Suspicious or predatory event:** use "Report this event" on the event page. Reports go to the maintainers privately.

## What we accept

See the [curation policy](docs/curation-policy.md). In short: computational and theoretical chemistry events with an official page, an identifiable organiser and a real scientific programme. Maintainers may decline or remove listings that don't meet the criteria and will explain why.

## Code contributions

Read [AGENTS.md](AGENTS.md) for conventions, which apply to human contributors too. In brief:

- Small, focused pull requests with Conventional Commit messages.
- Run `npm run lint && npm run typecheck && npm run validate && npm test` before pushing.
- Schema changes must update the docs, JSON Schema, validator, fixtures and tests together.

## Conduct

Be respectful and assume good faith. Discuss events and evidence, not people.
