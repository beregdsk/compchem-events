# Computational Chemistry Events Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, community-maintained website that lists computational chemistry conferences, workshops and schools from YAML files, with client-side filtering, event pages, and calendar/feed exports.

**Architecture:** YAML event files are the single source of truth. A build-time loader parses, validates and sorts them; invalid data fails the build. Astro renders every page to static HTML with no client-side rendering — one small vanilla-TypeScript island toggles `hidden` on already-rendered rows for filtering, so the site is complete and readable with JavaScript disabled.

**Tech Stack:** Astro (static output), TypeScript strict, Node 24 LTS, Ajv (JSON Schema 2020-12), the `yaml` package, Vitest, ical.js (tests only). No UI framework. No runtime dependencies in the built output.

**Spec:** `docs/superpowers/specs/2026-09-20-compchem-events-site-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **TypeScript strict.** No `any` without a comment explaining why.
- **Dates are ISO `YYYY-MM-DD` strings in data.** Parse and compare them as UTC calendar dates, never through the local timezone. `src/lib/dates.ts` is the only place dates are parsed.
- **No tracking.** No analytics, cookies, third-party scripts, external fonts or CDNs. Everything self-hosted in the build output.
- **No runtime network requests** in the built site.
- **System font stack only.** Spec D2 — `CLAUDE.md`'s typography instruction is explicitly overridden for this project. Do not add a webfont.
- **Under 30 kB gzipped JavaScript on `/`.**
- **The site must be readable and complete with JavaScript disabled.** JS only ever enhances.
- **No secrets in the repo.** Site-specific values live only in `site.config.ts`, as clearly marked placeholders.
- **Never invent event data.** Every real event needs a `source_url` on the organiser's official site and a truthful `last_verified`. If you cannot verify it, leave it out and say so.
- **Accessibility is a requirement:** semantic HTML, labelled controls, visible focus, WCAG AA contrast, `prefers-color-scheme` and `prefers-reduced-motion` respected, responsive to 360 px.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). One branch per phase, `feat/phase-N-<slug>`, merged `--no-ff` into `main`.
- **Gates before every commit:** `npm run lint && npm run typecheck && npm run validate && npm test && npm run build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `site.config.ts` | Every site-specific value. Nothing else hard-codes these. |
| `astro.config.ts` | Astro setup: static output, trailing slashes, site URL from `site.config.ts`. |
| `schema/event.schema.json` | JSON Schema 2020-12. Structural contract only. |
| `data/topics.yaml` | Controlled vocabulary: 20 slugs with labels. |
| `data/blocklist.yaml` | Blocked organiser domains. Ships empty with a format header. |
| `data/events/<year>/<id>.yaml` | One event per file. Source of truth. |
| `src/lib/types.ts` | Shared `Event`, `Deadline`, `Region`, `Status` types. Consumed by validator, loader and pages. |
| `src/lib/dates.ts` | UTC calendar-date parsing, comparison, arithmetic. The only date parser. |
| `src/lib/regions.ts` | `regionOf(country)` — ISO alpha-2 to geographic region. Pure, no format awareness. |
| `src/lib/filter.ts` | Pure filter logic: parse/serialise URL state, decide whether a row matches. Shared by page and island. |
| `src/lib/ical.ts` | iCalendar serialisation: folding, escaping, exclusive `DTEND`, stable UIDs. |
| `src/lib/events.ts` | The single loader. Parse, validate, drop fixtures, sort, derive `status` and `region`. |
| `src/lib/validation.ts` | Schema plus the eight semantic rules and four warnings. The logic. |
| `scripts/validate.ts` | Thin CLI that re-exports `validateEvent` as the discovery agent's stable entry point. |
| `src/styles/global.css` | The "Isosurface" design system: tokens, both themes, layout primitives. |
| `src/layouts/Base.astro` | Shell: head, meta, canonical, OpenGraph, skip link, header, footer. |
| `src/components/EventRow.astro` | One event as a list row, carrying the filter data attributes. |
| `src/components/DeadlineList.astro` | Deadlines table for an event page. |
| `src/pages/index.astro` | `/` — upcoming and ongoing, with the filter form. |
| `src/pages/events/[id].astro` | `/events/<id>/` — detail, JSON-LD, report and correction links. |
| `src/pages/deadlines.astro` | `/deadlines/` — deadlines across all events, soonest first. |
| `src/pages/archive.astro` | `/archive/` — past events grouped by year. |
| `src/pages/about.astro`, `submit.astro`, `policy.astro`, `404.astro` | Static pages. |
| `src/pages/events.ics.ts`, `deadlines.ics.ts`, `feed.xml.ts`, `events.json.ts`, `sitemap.xml.ts`, `robots.txt.ts` | Generated endpoints. |
| `src/scripts/filters.ts` | Client island: DOM glue over `src/lib/filter.ts`. |
| `src/scripts/countdown.ts` | Client island: upgrades `<time>` elements to relative countdowns. |
| `tests/**` | Vitest unit tests plus `fixtures/valid/` and `fixtures/invalid/`. |

---

## Task 1: Scaffold, tooling and configuration

Phase 0. Branch: `feat/phase-0-scaffold`.

**Files:**
- Create: `.nvmrc`, `package.json`, `astro.config.ts`, `tsconfig.json`, `site.config.ts`, `eslint.config.js`, `.prettierrc.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `docs/decisions.md`
- Move: root `*.md` docs into `docs/`, `pull_request_template.md` into `.github/`

**Interfaces:**
- Consumes: nothing.
- Produces: `site` (typed `SiteConfig`) and `siteDomain` (string) exported from `site.config.ts`; the npm scripts `dev`, `build`, `preview`, `lint`, `typecheck`, `test`, `validate` that every later task depends on.

- [ ] **Step 1: Create the branch and pin Node**

```bash
git checkout -b feat/phase-0-scaffold
node --version    # note the major version
```

Write the major version you just saw into `.nvmrc` (this plan assumes `24`; if yours differs, use yours and note it in `docs/decisions.md`):

```bash
echo "24" > .nvmrc
```

- [ ] **Step 2: Relocate the documentation to match every existing cross-reference**

`README.md`, `CONTRIBUTING.md` and `AGENTS.md` all link to `docs/…`, but the files currently sit at the repo root. This is spec correction C3.

```bash
git mv curation-policy.md data-schema.md discovery-agent.md docs/
mkdir -p .github
git mv pull_request_template.md .github/
ls docs/
```

Expected: `curation-policy.md`, `data-schema.md`, `decisions.md` (next step), `discovery-agent.md`, `superpowers/`.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "compchem-events",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "typecheck": "astro check",
    "test": "vitest run",
    "validate": "tsx scripts/validate.ts"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install astro yaml ajv ajv-formats
npm install -D typescript @astrojs/check vitest tsx eslint @eslint/js typescript-eslint eslint-plugin-astro prettier prettier-plugin-astro ical.js @types/node
```

Dependency justifications, for the PR description (AGENTS.md rule 8):
- `yaml` — YAML 1.2 parser. **Chosen over `js-yaml` deliberately:** js-yaml follows YAML 1.1 and silently converts `2026-03-08` into a JavaScript `Date` object in the local timezone, which would break the UTC date invariant at the parse step. The `yaml` package's default core schema leaves dates as strings.
- `ajv` + `ajv-formats` — JSON Schema 2020-12 validation. Build-time only.
- `tsx` — runs `scripts/validate.ts` directly. Dev-only, never shipped.
- `ical.js` — parses our own `.ics` output back in tests. Dev-only.

None of these reach the browser.

- [ ] **Step 5: Write `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 6: Write `site.config.ts` with clearly marked placeholders**

Every value here is a placeholder until the maintainer supplies the real one (spec §12). Nothing else in the codebase may hard-code any of it.

```ts
export interface ReportFormConfig {
  /** Base URL of the external report form. */
  url: string;
  /** Query-parameter name that carries the event id. */
  eventIdParam: string;
  /** Query-parameter name that carries the event page URL. */
  eventUrlParam: string;
}

export interface SiteConfig {
  name: string;
  tagline: string;
  /** Production origin, no trailing slash. Used for canonical URLs and iCalendar UIDs. */
  url: string;
  contactEmail: string;
  repoUrl: string;
  reportForm: ReportFormConfig;
  submissionFormUrl: string;
}

export const site: SiteConfig = {
  name: 'CompChem Events',
  tagline: 'Conferences, workshops and schools in computational chemistry',
  url: 'https://placeholder.example',
  contactEmail: 'placeholder@example.org',
  repoUrl: 'https://github.com/PLACEHOLDER-OWNER/PLACEHOLDER-REPO',
  reportForm: {
    url: 'https://placeholder.example/report',
    eventIdParam: 'event_id',
    eventUrlParam: 'event_url',
  },
  submissionFormUrl: 'https://placeholder.example/submit',
};

/** Host portion of the production URL, used for iCalendar UIDs. */
export const siteDomain = new URL(site.url).host;
```

- [ ] **Step 7: Write `astro.config.ts`**

```ts
import { defineConfig } from 'astro/config';
import { site } from './site.config';

export default defineConfig({
  site: site.url,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 9: Write `eslint.config.js` and `.prettierrc.json`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.astro/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      // Deliberately unused parameters are marked with a leading underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
```

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "plugins": ["prettier-plugin-astro"],
  "overrides": [{ "files": "*.astro", "options": { "parser": "astro" } }]
}
```

- [ ] **Step 10: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run validate
      - run: npm test
      - run: npm run build
```

- [ ] **Step 11: Create `docs/decisions.md` and record the brainstorm decisions**

```markdown
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
```

- [ ] **Step 12: Create the minimal files the build needs, then verify every gate**

`npm run build` needs at least one page, and `npm run validate` needs the script to exist. Create stubs so the gates are real from this task onward.

```bash
mkdir -p src/pages tests scripts
cat > src/pages/index.astro <<'EOF'
---
import { site } from '../../site.config';
---
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>{site.name}</title></head>
  <body><h1>{site.name}</h1></body>
</html>
EOF
cat > scripts/validate.ts <<'EOF'
// Replaced in Task 5. Exits zero so the phase-0 gates are meaningful.
console.log('validate: no data files yet');
EOF
cat > tests/smoke.test.ts <<'EOF'
import { describe, expect, it } from 'vitest';
import { site, siteDomain } from '../site.config';

describe('site config', () => {
  it('exposes a parseable production URL', () => {
    expect(siteDomain).toBe('placeholder.example');
  });

  it('carries both report-form parameter names', () => {
    expect(site.reportForm.eventIdParam).toBeTruthy();
    expect(site.reportForm.eventUrlParam).toBeTruthy();
  });
});
EOF
```

- [ ] **Step 13: Run every gate**

Run: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build`
Expected: all five pass. `dist/index.html` exists.

- [ ] **Step 14: Write `.gitignore` additions and commit**

```bash
git add -A
git commit -m "feat: scaffold Astro project with strict TypeScript and CI

Adds package.json, tsconfig, Astro config, ESLint, Prettier, Vitest and a
GitHub Actions workflow running lint, typecheck, validate, test and build.

Relocates docs to docs/ and the PR template to .github/ so the existing
cross-references in README, CONTRIBUTING and AGENTS resolve.

Adds site.config.ts with clearly marked placeholders and docs/decisions.md
recording the decisions taken during brainstorming."
```

---

## Task 2: UTC calendar dates

Phase 1. Branch: `feat/phase-1-data-layer` (create it now; tasks 2-8 all land on it).

Every date bug in this codebase would come from local-timezone parsing. This module exists so there is exactly one place that can be wrong, and it is tested.

**Files:**
- Create: `src/lib/dates.ts`, `tests/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ISODate = string`
  - `parseISODate(s: string): number` — epoch ms at UTC midnight; throws `RangeError` on a malformed or non-existent date
  - `toISODate(ms: number): ISODate`
  - `addDays(d: ISODate, n: number): ISODate`
  - `daysBetween(from: ISODate, to: ISODate): number`
  - `compareISO(a: ISODate, b: ISODate): number`
  - `todayUTC(now?: Date): ISODate`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareISO,
  daysBetween,
  parseISODate,
  todayUTC,
  toISODate,
} from '../../src/lib/dates';

describe('parseISODate', () => {
  it('parses a date as UTC midnight', () => {
    expect(parseISODate('2026-03-08')).toBe(Date.UTC(2026, 2, 8));
  });

  it('rejects a malformed string', () => {
    expect(() => parseISODate('08/03/2026')).toThrow(RangeError);
  });

  it('rejects a date that does not exist', () => {
    expect(() => parseISODate('2026-02-30')).toThrow(RangeError);
  });

  it('accepts a real leap day', () => {
    expect(toISODate(parseISODate('2028-02-29'))).toBe('2028-02-29');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses a leap-year boundary', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('subtracts', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('daysBetween', () => {
  it('counts forward', () => {
    expect(daysBetween('2026-03-01', '2026-03-11')).toBe(10);
  });

  it('is negative backwards', () => {
    expect(daysBetween('2026-03-11', '2026-03-01')).toBe(-10);
  });

  it('is zero for the same day', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('compareISO', () => {
  it('sorts ascending', () => {
    const input = ['2027-01-05', '2026-12-31', '2027-01-04'];
    expect([...input].sort(compareISO)).toEqual(['2026-12-31', '2027-01-04', '2027-01-05']);
  });
});

describe('todayUTC', () => {
  it('uses the UTC calendar day, not the local one', () => {
    // 23:30 UTC on 1 March is already 2 March in Sydney and still 1 March in UTC.
    expect(todayUTC(new Date('2026-03-01T23:30:00Z'))).toBe('2026-03-01');
  });

  it('handles the first instant of a day', () => {
    expect(todayUTC(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03-02');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/dates`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/dates.ts`:

```ts
/** A calendar date in ISO `YYYY-MM-DD` form. Always interpreted as UTC. */
export type ISODate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/**
 * Parse an ISO calendar date to epoch milliseconds at UTC midnight.
 * Throws rather than coercing, so bad data fails the build loudly.
 */
export function parseISODate(s: string): number {
  const m = ISO_DATE.exec(s);
  if (!m) throw new RangeError(`not an ISO YYYY-MM-DD date: ${JSON.stringify(s)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  // Date.UTC rolls 2026-02-30 forward to 2026-03-02 instead of failing, so
  // round-trip the components to reject dates that do not exist.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`date does not exist: ${s}`);
  }
  return ms;
}

export function toISODate(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return toISODate(parseISODate(d) + n * MS_PER_DAY);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((parseISODate(to) - parseISODate(from)) / MS_PER_DAY);
}

export function compareISO(a: ISODate, b: ISODate): number {
  // ISO dates are lexicographically ordered, so string comparison is correct
  // and avoids parsing in hot sort paths.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The current UTC calendar date. Inject `now` in tests. */
export function todayUTC(now: Date = new Date()): ISODate {
  return now.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/phase-1-data-layer
git add src/lib/dates.ts tests/lib/dates.test.ts
git commit -m "feat: add UTC calendar date utilities

Single parsing point for all dates in the codebase. Rejects malformed and
non-existent dates rather than coercing, so invalid data fails loudly."
```

---

## Task 3: Region lookup

**Files:**
- Create: `src/lib/regions.ts`, `tests/lib/regions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Region = 'Europe' | 'North America' | 'Latin America' | 'Asia' | 'Middle East' | 'Africa' | 'Oceania'`
  - `type DisplayRegion = Region | 'Online'`
  - `regionOf(country: string): Region | undefined`
  - `COUNTRY_REGIONS: Readonly<Record<string, Region>>`
  - `REGIONS: readonly Region[]`

Note the contract: `regionOf` is purely geographic and knows nothing about event format. `'Online'` is derived in the loader (Task 7), per spec D6.

An unknown country returning `undefined` is deliberate. The validator (Task 6) turns that into an error naming the country and telling the contributor to extend this table, which is better than silently bucketing an event into the wrong region.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/regions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COUNTRY_REGIONS, REGIONS, regionOf } from '../../src/lib/regions';

describe('regionOf', () => {
  it('maps European codes', () => {
    expect(regionOf('DE')).toBe('Europe');
    expect(regionOf('GB')).toBe('Europe');
    expect(regionOf('CH')).toBe('Europe');
  });

  it('separates North from Latin America', () => {
    expect(regionOf('US')).toBe('North America');
    expect(regionOf('CA')).toBe('North America');
    expect(regionOf('MX')).toBe('Latin America');
    expect(regionOf('BR')).toBe('Latin America');
  });

  it('separates Asia from the Middle East', () => {
    expect(regionOf('JP')).toBe('Asia');
    expect(regionOf('IN')).toBe('Asia');
    expect(regionOf('IL')).toBe('Middle East');
    expect(regionOf('AE')).toBe('Middle East');
  });

  it('covers Africa and Oceania', () => {
    expect(regionOf('ZA')).toBe('Africa');
    expect(regionOf('AU')).toBe('Oceania');
    expect(regionOf('NZ')).toBe('Oceania');
  });

  it('returns undefined for an unknown code so the validator can report it', () => {
    expect(regionOf('ZZ')).toBeUndefined();
  });

  it('does not silently accept lowercase', () => {
    expect(regionOf('de')).toBeUndefined();
  });
});

describe('COUNTRY_REGIONS', () => {
  it('contains only real ISO 3166-1 alpha-2 codes', () => {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of Object.keys(COUNTRY_REGIONS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      // Intl returns the input unchanged when it does not know the region.
      expect(display.of(code)).not.toBe(code);
    }
  });

  it('maps every entry to a declared region', () => {
    for (const region of Object.values(COUNTRY_REGIONS)) {
      expect(REGIONS).toContain(region);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/regions.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/regions`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/regions.ts`:

```ts
export const REGIONS = [
  'Europe',
  'North America',
  'Latin America',
  'Asia',
  'Middle East',
  'Africa',
  'Oceania',
] as const;

export type Region = (typeof REGIONS)[number];

/** What a page displays. Online events have no country, so they get their own bucket. */
export type DisplayRegion = Region | 'Online';

/**
 * ISO 3166-1 alpha-2 to geographic region.
 *
 * Deliberately not exhaustive over all ~250 codes: it covers the countries that
 * host computational chemistry events. An unlisted country is an error the
 * validator reports, asking the contributor to extend this table, rather than a
 * silent mis-bucketing.
 */
export const COUNTRY_REGIONS: Readonly<Record<string, Region>> = {
  // Europe
  AT: 'Europe', BE: 'Europe', BG: 'Europe', BA: 'Europe', BY: 'Europe',
  CH: 'Europe', CY: 'Europe', CZ: 'Europe', DE: 'Europe', DK: 'Europe',
  EE: 'Europe', ES: 'Europe', FI: 'Europe', FR: 'Europe', GB: 'Europe',
  GR: 'Europe', HR: 'Europe', HU: 'Europe', IE: 'Europe', IS: 'Europe',
  IT: 'Europe', LT: 'Europe', LU: 'Europe', LV: 'Europe', MT: 'Europe',
  NL: 'Europe', NO: 'Europe', PL: 'Europe', PT: 'Europe', RO: 'Europe',
  RS: 'Europe', RU: 'Europe', SE: 'Europe', SI: 'Europe', SK: 'Europe',
  UA: 'Europe',

  // North America
  CA: 'North America', US: 'North America',

  // Latin America
  AR: 'Latin America', BR: 'Latin America', CL: 'Latin America',
  CO: 'Latin America', CR: 'Latin America', CU: 'Latin America',
  EC: 'Latin America', MX: 'Latin America', PE: 'Latin America',
  UY: 'Latin America', VE: 'Latin America',

  // Asia
  CN: 'Asia', HK: 'Asia', ID: 'Asia', IN: 'Asia', JP: 'Asia',
  KR: 'Asia', MY: 'Asia', PH: 'Asia', SG: 'Asia', TH: 'Asia',
  TW: 'Asia', VN: 'Asia',

  // Middle East
  AE: 'Middle East', IL: 'Middle East', IR: 'Middle East', JO: 'Middle East',
  QA: 'Middle East', SA: 'Middle East', TR: 'Middle East',

  // Africa
  DZ: 'Africa', EG: 'Africa', ET: 'Africa', GH: 'Africa', KE: 'Africa',
  MA: 'Africa', NG: 'Africa', RW: 'Africa', SN: 'Africa', TN: 'Africa',
  UG: 'Africa', ZA: 'Africa',

  // Oceania
  AU: 'Oceania', NZ: 'Oceania',
};

/** Geographic region for an ISO alpha-2 code, or undefined if the table lacks it. */
export function regionOf(country: string): Region | undefined {
  return COUNTRY_REGIONS[country];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/regions.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/regions.ts tests/lib/regions.test.ts
git commit -m "feat: add ISO country to geographic region lookup

Purely geographic per spec D6; Online is derived in the loader. Unknown
countries return undefined so the validator can report them by name rather
than mis-bucketing the event."
```

---
## Task 4: Shared types, JSON Schema and controlled vocabulary

**Files:**
- Create: `src/lib/types.ts`, `schema/event.schema.json`, `data/topics.yaml`, `data/blocklist.yaml`, `tests/schema/schema.test.ts`

**Interfaces:**
- Consumes: `DisplayRegion` from `src/lib/regions.ts`; `ISODate` from `src/lib/dates.ts`.
- Produces:
  - `EVENT_TYPES`, `EVENT_FORMATS`, `DEADLINE_TYPES`, `EVENT_STATUSES` — const tuples
  - `EventType`, `EventFormat`, `DeadlineType`, `EventStatus`, `DerivedStatus` — types
  - `Deadline`, `EventLocation`, `RawEvent`, `LoadedEvent` — interfaces
  - `schema/event.schema.json` — the structural contract

- [ ] **Step 1: Write `src/lib/types.ts`**

```ts
import type { ISODate } from './dates';
import type { DisplayRegion } from './regions';

export const EVENT_TYPES = [
  'conference',
  'workshop',
  'school',
  'symposium',
  'webinar',
  'hackathon',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_FORMATS = ['in-person', 'hybrid', 'online'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const DEADLINE_TYPES = [
  'abstract',
  'registration',
  'early_bird',
  'travel_grant',
  'poster',
  'application',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

export const EVENT_STATUSES = ['scheduled', 'postponed', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Derived from the build date, not stored in the YAML. */
export type DerivedStatus = 'upcoming' | 'ongoing' | 'past';

export interface Deadline {
  type: DeadlineType;
  date: ISODate;
  /** `AoE` (default), `UTC`, or an IANA zone name. */
  timezone?: string;
  note?: string;
}

export interface EventLocation {
  city: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  venue?: string;
}

/** An event exactly as it appears in its YAML file. */
export interface RawEvent {
  id: string;
  title: string;
  series?: string;
  type: EventType;
  start_date: ISODate;
  end_date: ISODate;
  format: EventFormat;
  location?: EventLocation;
  url: string;
  source_url?: string;
  organizer?: string;
  topics: string[];
  description: string;
  deadlines?: Deadline[];
  status?: EventStatus;
  status_note?: string;
  added: ISODate;
  last_verified: ISODate;
  fixture?: boolean;
}

/** A `RawEvent` after the loader has derived display fields. */
export interface LoadedEvent extends RawEvent {
  region: DisplayRegion;
  status_derived: DerivedStatus;
}

export interface Topic {
  slug: string;
  label: string;
}
```

- [ ] **Step 2: Write `schema/event.schema.json`**

This implements `docs/data-schema.md` structurally. The eight semantic rules are **not** here — they need cross-field and cross-file context and live in Task 6.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.invalid/schema/event.schema.json",
  "title": "Event",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id",
    "title",
    "type",
    "start_date",
    "end_date",
    "format",
    "url",
    "topics",
    "description",
    "added",
    "last_verified"
  ],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*-\\d{4}$" },
    "title": { "type": "string", "minLength": 5, "maxLength": 140 },
    "series": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
    "type": {
      "enum": ["conference", "workshop", "school", "symposium", "webinar", "hackathon"]
    },
    "start_date": { "$ref": "#/$defs/date" },
    "end_date": { "$ref": "#/$defs/date" },
    "format": { "enum": ["in-person", "hybrid", "online"] },
    "location": {
      "type": "object",
      "additionalProperties": false,
      "required": ["city", "country"],
      "properties": {
        "city": { "type": "string", "minLength": 1, "maxLength": 100 },
        "country": { "type": "string", "pattern": "^[A-Z]{2}$" },
        "venue": { "type": "string", "maxLength": 200 }
      }
    },
    "url": { "type": "string", "format": "uri", "pattern": "^https://" },
    "source_url": { "type": "string", "format": "uri", "pattern": "^https://" },
    "organizer": { "type": "string", "minLength": 1, "maxLength": 200 },
    "topics": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "uniqueItems": true,
      "items": { "type": "string" }
    },
    "description": { "type": "string", "minLength": 1, "maxLength": 280 },
    "deadlines": { "type": "array", "items": { "$ref": "#/$defs/deadline" } },
    "status": { "enum": ["scheduled", "postponed", "cancelled"] },
    "status_note": { "type": "string", "minLength": 1, "maxLength": 200 },
    "added": { "$ref": "#/$defs/date" },
    "last_verified": { "$ref": "#/$defs/date" },
    "fixture": { "type": "boolean" }
  },
  "allOf": [
    {
      "if": {
        "required": ["status"],
        "properties": { "status": { "enum": ["postponed", "cancelled"] } }
      },
      "then": { "required": ["status_note"] }
    }
  ],
  "$defs": {
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "deadline": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "date"],
      "properties": {
        "type": {
          "enum": [
            "abstract",
            "registration",
            "early_bird",
            "travel_grant",
            "poster",
            "application"
          ]
        },
        "date": { "$ref": "#/$defs/date" },
        "timezone": { "type": "string", "minLength": 1, "maxLength": 64 },
        "note": { "type": "string", "maxLength": 200 }
      }
    }
  }
}
```

- [ ] **Step 3: Write `data/topics.yaml`**

The exact 20 slugs from `docs/data-schema.md`. Adding a topic is a schema-level change; keep the list short and reject near-duplicates.

```yaml
# Controlled vocabulary for event topics.
# Adding a slug is a schema-level change: update docs/data-schema.md in the
# same pull request and keep the list short. Reject near-duplicates.
- slug: electronic-structure
  label: Electronic structure
- slug: dft
  label: Density functional theory
- slug: wavefunction-methods
  label: Wavefunction methods
- slug: excited-states
  label: Excited states
- slug: photochemistry
  label: Photochemistry
- slug: quantum-dynamics
  label: Quantum dynamics
- slug: molecular-dynamics
  label: Molecular dynamics
- slug: enhanced-sampling
  label: Enhanced sampling
- slug: biomolecular-simulation
  label: Biomolecular simulation
- slug: soft-matter
  label: Soft matter
- slug: ml-potentials
  label: Machine-learned potentials
- slug: ml-chemistry
  label: Machine learning for chemistry
- slug: cheminformatics
  label: Cheminformatics
- slug: drug-design
  label: Computational drug design
- slug: materials-modeling
  label: Materials modelling
- slug: catalysis
  label: Catalysis
- slug: spectroscopy
  label: Computational spectroscopy
- slug: quantum-computing-chemistry
  label: Quantum computing for chemistry
- slug: software-hpc
  label: Software and HPC
- slug: education-training
  label: Education and training
```

- [ ] **Step 4: Write `data/blocklist.yaml`**

```yaml
# Organiser domains that must not be listed.
#
# Each entry requires maintainer approval in a pull request and needs at least
# one public evidence link. Describe conduct and evidence, not motives. See
# docs/curation-policy.md. Anyone can request a review by opening an issue.
#
# Format:
#   - domain: example-predatory-publisher.com
#     added: 2026-09-20
#     evidence:
#       - https://example.org/published-report
#     note: Short factual description of the documented conduct.
#
# Matching is on the registrable host and all its subdomains.
# The list is intentionally empty until there is evidence to add.
```

- [ ] **Step 5: Write the failing schema test**

Create `tests/schema/schema.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ValidateFunction } from 'ajv';
import type { Topic } from '../../src/lib/types';

let validate: ValidateFunction;

const base = {
  id: 'example-workshop-2027',
  title: 'Example Workshop on Excited-State Methods',
  type: 'workshop',
  start_date: '2027-03-08',
  end_date: '2027-03-10',
  format: 'in-person',
  location: { city: 'Exampleville', country: 'NL' },
  url: 'https://example.org/excited-states-2027/',
  topics: ['excited-states'],
  description: 'Three days of talks and tutorials.',
  added: '2026-09-20',
  last_verified: '2026-09-20',
};

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync('schema/event.schema.json', 'utf8'));
  validate = ajv.compile(schema);
});

describe('event schema', () => {
  it('accepts a minimal valid event', () => {
    expect(validate(base)).toBe(true);
  });

  it('rejects an id that does not end in a year', () => {
    expect(validate({ ...base, id: 'example-workshop' })).toBe(false);
  });

  it('rejects an unknown top-level property', () => {
    expect(validate({ ...base, rating: 5 })).toBe(false);
  });

  it('rejects a non-https url', () => {
    expect(validate({ ...base, url: 'http://example.org/x/' })).toBe(false);
  });

  it('rejects more than five topics', () => {
    expect(validate({ ...base, topics: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe(false);
  });

  it('rejects duplicate topics', () => {
    expect(validate({ ...base, topics: ['dft', 'dft'] })).toBe(false);
  });

  it('rejects a description over 280 characters', () => {
    expect(validate({ ...base, description: 'x'.repeat(281) })).toBe(false);
  });

  it('rejects a lowercase country code', () => {
    expect(validate({ ...base, location: { city: 'X', country: 'nl' } })).toBe(false);
  });

  it('requires status_note when status is cancelled', () => {
    expect(validate({ ...base, status: 'cancelled' })).toBe(false);
    expect(validate({ ...base, status: 'cancelled', status_note: 'Called off.' })).toBe(true);
  });

  it('does not require status_note when status is scheduled', () => {
    expect(validate({ ...base, status: 'scheduled' })).toBe(true);
  });

  it('rejects a repeated deadline shape error', () => {
    expect(validate({ ...base, deadlines: [{ type: 'unknown', date: '2027-01-01' }] })).toBe(false);
  });
});

describe('controlled vocabulary', () => {
  it('parses as a list of slug/label pairs', () => {
    const topics = parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[];
    expect(topics).toHaveLength(20);
    for (const t of topics) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate slugs', () => {
    const topics = parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[];
    expect(new Set(topics.map((t) => t.slug)).size).toBe(topics.length);
  });
});

describe('yaml date handling', () => {
  it('leaves bare dates as strings, not Date objects', () => {
    // This is why the project uses `yaml` rather than `js-yaml`. If this test
    // ever fails, the UTC date invariant is broken at the parse step.
    const parsed = parse('start_date: 2027-03-08') as Record<string, unknown>;
    expect(typeof parsed.start_date).toBe('string');
    expect(parsed.start_date).toBe('2027-03-08');
  });
});

describe('blocklist', () => {
  it('parses, and is empty until there is evidence to add', () => {
    const raw = parse(readFileSync('data/blocklist.yaml', 'utf8'));
    // A comments-only YAML file parses to null.
    expect(raw ?? []).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/schema/schema.test.ts`
Expected: PASS, 16 tests. If the `yaml date handling` test fails, stop — the wrong YAML library is installed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts schema/ data/topics.yaml data/blocklist.yaml tests/schema/
git commit -m "feat: add event JSON Schema, shared types and controlled vocabulary

Implements the structural half of docs/data-schema.md. Semantic rules follow
in the validator. Includes a regression test asserting the YAML parser leaves
bare dates as strings."
```

---

## Task 5: Validator — schema layer and CLI

**Files:**
- Create: `src/lib/validation.ts`, `tests/lib/validation.test.ts`
- Replace: `scripts/validate.ts` (the stub from Task 1)

`src/lib/validation.ts` holds the logic; `scripts/validate.ts` is a thin CLI that imports and **re-exports** `validateEvent`, so `import { validateEvent } from '../scripts/validate'` works as `TASK.md` §7 promises the discovery agent while keeping each file focused. This refines the file table above.

**Interfaces:**
- Consumes: `RawEvent`, `Topic` from `src/lib/types.ts`; `ISODate`, `todayUTC` from `src/lib/dates.ts`.
- Produces:
  - `interface Problem { file: string; field: string; message: string }`
  - `interface ValidationResult { errors: Problem[]; warnings: Problem[] }`
  - `interface ValidationContext { topics: ReadonlySet<string>; blockedHosts: ReadonlySet<string>; today: ISODate }`
  - `interface EventFile { file: string; data: unknown }`
  - `loadValidationContext(root?: string, today?: ISODate): ValidationContext`
  - `validateEvent(entry: EventFile, ctx: ValidationContext): ValidationResult`
  - `validateCollection(entries: EventFile[], ctx: ValidationContext): ValidationResult`
  - `formatProblems(result: ValidationResult): string`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');

const valid = {
  id: 'example-workshop-2027',
  title: 'Example Workshop on Excited-State Methods',
  type: 'workshop',
  start_date: '2027-03-08',
  end_date: '2027-03-10',
  format: 'in-person',
  location: { city: 'Exampleville', country: 'NL' },
  url: 'https://example.org/excited-states-2027/',
  topics: ['excited-states'],
  description: 'Three days of talks and tutorials on excited-state methods.',
  added: '2026-09-20',
  last_verified: '2026-09-20',
  fixture: true,
};

const file = 'data/events/2027/example-workshop-2027.yaml';

describe('validation context', () => {
  it('loads the controlled vocabulary', () => {
    expect(ctx.topics.has('excited-states')).toBe(true);
    expect(ctx.topics.has('not-a-topic')).toBe(false);
  });

  it('starts with an empty blocklist', () => {
    expect(ctx.blockedHosts.size).toBe(0);
  });
});

describe('validateEvent schema layer', () => {
  it('accepts a valid event', () => {
    const r = validateEvent({ file, data: valid }, ctx);
    expect(r.errors).toEqual([]);
  });

  it('reports the field path for a schema violation', () => {
    const r = validateEvent({ file, data: { ...valid, url: 'http://example.org/x/' } }, ctx);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.file).toBe(file);
    expect(r.errors[0]?.field).toContain('url');
  });

  it('reports every problem, not just the first', () => {
    const r = validateEvent(
      { file, data: { ...valid, url: 'http://x.example/a/', title: 'no' } },
      ctx,
    );
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a non-object', () => {
    const r = validateEvent({ file, data: 'not an event' }, ctx);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('names missing required fields', () => {
    const { title, ...withoutTitle } = valid;
    void title;
    const r = validateEvent({ file, data: withoutTitle }, ctx);
    expect(r.errors.some((e) => e.field.includes('title'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/validation.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/validation`.

- [ ] **Step 3: Write the schema layer of `src/lib/validation.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import type { ISODate } from './dates';
import { todayUTC } from './dates';
import type { Topic } from './types';

export interface Problem {
  /** Path of the offending file, relative to the repo root. */
  file: string;
  /** Field path inside the file, e.g. `location/country`. */
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: Problem[];
  warnings: Problem[];
}

export interface ValidationContext {
  topics: ReadonlySet<string>;
  blockedHosts: ReadonlySet<string>;
  today: ISODate;
}

export interface EventFile {
  file: string;
  data: unknown;
}

interface BlocklistEntry {
  domain: string;
}

let compiled: ValidateFunction | undefined;

function schemaValidator(root: string): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(readFileSync(join(root, 'schema/event.schema.json'), 'utf8')));
  }
  return compiled;
}

export function loadValidationContext(root = '.', today: ISODate = todayUTC()): ValidationContext {
  const topics = parse(readFileSync(join(root, 'data/topics.yaml'), 'utf8')) as Topic[] | null;
  const blocklist = parse(readFileSync(join(root, 'data/blocklist.yaml'), 'utf8')) as
    | BlocklistEntry[]
    | null;
  return {
    topics: new Set((topics ?? []).map((t) => t.slug)),
    blockedHosts: new Set((blocklist ?? []).map((b) => b.domain.toLowerCase())),
    today,
  };
}

export function validateEvent(entry: EventFile, ctx: ValidationContext): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };
  const validate = schemaValidator('.');

  if (!validate(entry.data)) {
    for (const err of validate.errors ?? []) {
      const field = err.instancePath.replace(/^\//, '') || err.params?.missingProperty || '(root)';
      result.errors.push({
        file: entry.file,
        field: String(field),
        message: err.message ?? 'schema violation',
      });
    }
    // Semantic rules assume a well-shaped object, so stop here.
    return result;
  }

  // Semantic rules are added in Task 6.
  return result;
}

export function formatProblems(result: ValidationResult): string {
  const line = (p: Problem, kind: string) => `${kind} ${p.file}: ${p.field}: ${p.message}`;
  return [
    ...result.errors.map((p) => line(p, 'ERROR')),
    ...result.warnings.map((p) => line(p, 'WARN ')),
  ].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/validation.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Replace the stub CLI**

Overwrite `scripts/validate.ts`:

```ts
#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  formatProblems,
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationResult,
} from '../src/lib/validation';

// Re-exported so the discovery agent (docs/discovery-agent.md) can depend on a
// stable entry point, as promised by TASK.md section 7.
export {
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type Problem,
  type ValidationContext,
  type ValidationResult,
} from '../src/lib/validation';

const EVENTS_DIR = 'data/events';

export function readEventFiles(root = '.'): EventFile[] {
  const dir = join(root, EVENTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: `${EVENTS_DIR}/${p.split('\\').join('/')}`,
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

function main(): void {
  const entries = readEventFiles();
  const ctx = loadValidationContext();
  const all: ValidationResult = { errors: [], warnings: [] };

  for (const entry of entries) {
    const r = validateEvent(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  const collection = validateCollection(entries, ctx);
  all.errors.push(...collection.errors);
  all.warnings.push(...collection.warnings);

  const report = formatProblems(all);
  if (report) console.log(report);

  console.log(
    `\nvalidate: ${entries.length} file(s), ${all.errors.length} error(s), ${all.warnings.length} warning(s)`,
  );
  process.exit(all.errors.length > 0 ? 1 : 0);
}

// Only run when invoked directly, so importing this module has no side effects.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main();
}
```

Add a temporary stub so this compiles before Task 6 — append to `src/lib/validation.ts`:

```ts
export function validateCollection(
  _entries: EventFile[],
  _ctx: ValidationContext,
): ValidationResult {
  // Cross-file rules are implemented in Task 6.
  return { errors: [], warnings: [] };
}
```

- [ ] **Step 6: Run the CLI and the full gate set**

Run: `npm run validate`
Expected: `validate: 0 file(s), 0 error(s), 0 warning(s)`, exit code 0.

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation.ts scripts/validate.ts tests/lib/validation.test.ts
git commit -m "feat: add JSON Schema validation with a reusable library entry point

Collects every schema violation rather than failing on the first, naming the
file and field for each. scripts/validate.ts re-exports validateEvent so the
discovery agent has the stable import TASK.md section 7 promises."
```

---

## Task 6: Validator — the eight semantic rules and four warnings

**Files:**
- Modify: `src/lib/validation.ts`
- Create: `tests/lib/semantic-rules.test.ts`, `tests/fixtures/valid/*.yaml`, `tests/fixtures/invalid/*.yaml`, `tests/fixtures/fixtures.test.ts`

**Interfaces:**
- Consumes: everything from Task 5, plus `parseISODate`, `compareISO`, `daysBetween` from `src/lib/dates.ts` and `regionOf` from `src/lib/regions.ts`.
- Produces: `validateEvent` and `validateCollection` now enforcing rules 1-8 and emitting warnings 1-4. No signature change.

- [ ] **Step 1: Write the failing semantic-rule test**

Create `tests/lib/semantic-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  loadValidationContext,
  validateCollection,
  validateEvent,
} from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');
const file = 'data/events/2027/example-workshop-2027.yaml';

const valid = {
  id: 'example-workshop-2027',
  title: 'Example Workshop on Excited-State Methods',
  type: 'workshop',
  start_date: '2027-03-08',
  end_date: '2027-03-10',
  format: 'in-person',
  location: { city: 'Exampleville', country: 'NL' },
  url: 'https://example.org/excited-states-2027/',
  topics: ['excited-states'],
  description: 'Three days of talks and tutorials on excited-state methods.',
  added: '2026-09-20',
  last_verified: '2026-09-20',
  fixture: true,
};

function errorsFor(data: unknown, path = file): string[] {
  return validateEvent({ file: path, data }, ctx).errors.map((e) => `${e.field}: ${e.message}`);
}

function warningsFor(data: unknown, path = file): string[] {
  return validateEvent({ file: path, data }, ctx).warnings.map((e) => `${e.field}: ${e.message}`);
}

describe('rule 1: id, file name and year agree', () => {
  it('accepts an id matching the file stem and start year', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it('rejects an id that differs from the file stem', () => {
    expect(errorsFor({ ...valid, id: 'other-workshop-2027' }).join()).toMatch(/file name/i);
  });

  it('rejects an id whose year differs from start_date', () => {
    expect(
      errorsFor({ ...valid, id: 'example-workshop-2028' }, 'data/events/2027/example-workshop-2028.yaml').join(),
    ).toMatch(/year/i);
  });

  it('rejects a file in the wrong year folder', () => {
    expect(
      errorsFor(valid, 'data/events/2026/example-workshop-2027.yaml').join(),
    ).toMatch(/folder/i);
  });
});

describe('rule 2: end_date is on or after start_date', () => {
  it('rejects an end before the start', () => {
    expect(errorsFor({ ...valid, end_date: '2027-03-07' }).join()).toMatch(/end_date/);
  });

  it('accepts a single-day event', () => {
    expect(errorsFor({ ...valid, end_date: '2027-03-08' })).toEqual([]);
  });
});

describe('rule 3: added and last_verified are sane', () => {
  it('rejects a future last_verified', () => {
    expect(errorsFor({ ...valid, last_verified: '2026-09-21' }).join()).toMatch(/future/i);
  });

  it('rejects a future added', () => {
    expect(errorsFor({ ...valid, added: '2026-09-21', last_verified: '2026-09-21' }).join()).toMatch(
      /future/i,
    );
  });

  it('rejects added after last_verified', () => {
    expect(
      errorsFor({ ...valid, added: '2026-09-20', last_verified: '2026-09-19' }).join(),
    ).toMatch(/added/i);
  });
});

describe('rule 4: topics and country are known', () => {
  it('rejects a topic outside the vocabulary', () => {
    expect(errorsFor({ ...valid, topics: ['quantum-astrology'] }).join()).toMatch(/topics/);
  });

  it('rejects a country missing from the region table', () => {
    expect(
      errorsFor({ ...valid, location: { city: 'X', country: 'ZZ' } }).join(),
    ).toMatch(/region table|country/i);
  });
});

describe('rule 6: urls are https and not blocked', () => {
  it('accepts an https source_url', () => {
    expect(errorsFor({ ...valid, source_url: 'https://example.org/about/' })).toEqual([]);
  });

  it('rejects a blocked host', () => {
    const blocked = {
      ...ctx,
      blockedHosts: new Set(['predatory.example']),
    };
    const r = validateEvent(
      { file, data: { ...valid, url: 'https://predatory.example/conf/' } },
      blocked,
    );
    expect(r.errors.map((e) => e.message).join()).toMatch(/blocklist/i);
  });

  it('rejects a blocked host on a subdomain', () => {
    const blocked = { ...ctx, blockedHosts: new Set(['predatory.example']) };
    const r = validateEvent(
      { file, data: { ...valid, url: 'https://www.predatory.example/conf/' } },
      blocked,
    );
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('rule 7: no deadline after end_date', () => {
  it('rejects it', () => {
    expect(
      errorsFor({ ...valid, deadlines: [{ type: 'abstract', date: '2027-03-11' }] }).join(),
    ).toMatch(/deadlines/);
  });
});

describe('rule 8: location required unless online', () => {
  it('rejects a missing location for an in-person event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor(noLocation).join()).toMatch(/location/);
  });

  it('accepts a missing location for an online event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor({ ...noLocation, format: 'online' })).toEqual([]);
  });

  it('requires a location for a hybrid event', () => {
    const { location, ...noLocation } = valid;
    void location;
    expect(errorsFor({ ...noLocation, format: 'hybrid' }).join()).toMatch(/location/);
  });
});

describe('rule 5: collection-level duplicates', () => {
  const a = { file: 'data/events/2027/a-2027.yaml', data: { ...valid, id: 'a-2027' } };

  it('rejects two events sharing an id', () => {
    const r = validateCollection([a, { ...a }], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate id/i);
  });

  it('rejects two events sharing a url', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: { ...valid, id: 'b-2027' },
    };
    const r = validateCollection([a, b], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate url/i);
  });

  it('rejects two events sharing a normalised title and start date', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'Example  Workshop on Excited-State Methods!',
      },
    };
    const r = validateCollection([a, b], ctx);
    expect(r.errors.map((e) => e.message).join()).toMatch(/duplicate title/i);
  });

  it('accepts genuinely distinct events', () => {
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'A Completely Different Meeting',
      },
    };
    expect(validateCollection([a, b], ctx).errors).toEqual([]);
  });
});

describe('warnings', () => {
  it('warns when a deadline falls after the start date', () => {
    expect(
      warningsFor({ ...valid, deadlines: [{ type: 'registration', date: '2027-03-09' }] }).join(),
    ).toMatch(/after the start/i);
  });

  it('warns when last_verified is over 90 days old and the event has not started', () => {
    expect(
      warningsFor({ ...valid, added: '2026-01-01', last_verified: '2026-01-01' }).join(),
    ).toMatch(/90 days/);
  });

  it('warns when the description looks copied', () => {
    expect(warningsFor({ ...valid, description: 'x'.repeat(201) }).join()).toMatch(/copied/i);
  });

  it('warns when the url is a bare homepage', () => {
    expect(warningsFor({ ...valid, url: 'https://example.org' }).join()).toMatch(/homepage/i);
  });

  it('does not warn for a url with a path', () => {
    expect(warningsFor(valid).join()).not.toMatch(/homepage/i);
  });

  it('warns about identical descriptions across events', () => {
    const a = { file: 'data/events/2027/a-2027.yaml', data: { ...valid, id: 'a-2027' } };
    const b = {
      file: 'data/events/2027/b-2027.yaml',
      data: {
        ...valid,
        id: 'b-2027',
        url: 'https://example.org/other/',
        title: 'A Completely Different Meeting',
      },
    };
    expect(validateCollection([a, b], ctx).warnings.map((w) => w.message).join()).toMatch(
      /identical description/i,
    );
  });

  it('warnings never appear as errors', () => {
    expect(errorsFor({ ...valid, url: 'https://example.org' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/semantic-rules.test.ts`
Expected: FAIL — most assertions fail because no semantic rules exist yet.

- [ ] **Step 3: Implement the semantic rules**

In `validateEvent`, replace these two lines:

```ts
  // Semantic rules are added in Task 6.
  return result;
```

with:

```ts
  semanticRules(entry, ctx, result);
  return result;
```

Then change the existing `node:path` import at the top of the file from
`import { join } from 'node:path';` to `import { basename, dirname, join } from 'node:path';`
and add the following below it:

```ts
import { compareISO, daysBetween } from './dates';
import { regionOf } from './regions';
import type { RawEvent } from './types';

/** Lowercase, strip punctuation, collapse whitespace — for duplicate detection. */
function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function isBlocked(url: string, blocked: ReadonlySet<string>): boolean {
  const host = hostOf(url);
  if (!host) return false;
  for (const domain of blocked) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function semanticRules(entry: EventFile, ctx: ValidationContext, out: ValidationResult): void {
  const e = entry.data as RawEvent;
  const err = (field: string, message: string) =>
    out.errors.push({ file: entry.file, field, message });
  const warn = (field: string, message: string) =>
    out.warnings.push({ file: entry.file, field, message });

  // Rule 1: id, file name and year agree.
  const stem = basename(entry.file, '.yaml');
  const folder = basename(dirname(entry.file));
  const startYear = e.start_date.slice(0, 4);
  if (e.id !== stem) err('id', `id "${e.id}" must equal the file name stem "${stem}"`);
  if (!e.id.endsWith(`-${startYear}`)) {
    err('id', `id must end with the start_date year "${startYear}"`);
  }
  if (folder !== startYear) {
    err('start_date', `file must sit in the folder for its start year, data/events/${startYear}/`);
  }

  // Rule 2: end_date on or after start_date.
  if (compareISO(e.end_date, e.start_date) < 0) {
    err('end_date', `end_date ${e.end_date} is before start_date ${e.start_date}`);
  }

  // Rule 3: added and last_verified are sane.
  if (compareISO(e.last_verified, ctx.today) > 0) {
    err('last_verified', `last_verified ${e.last_verified} is in the future`);
  }
  if (compareISO(e.added, ctx.today) > 0) {
    err('added', `added ${e.added} is in the future`);
  }
  if (compareISO(e.added, e.last_verified) > 0) {
    err('added', `added ${e.added} is after last_verified ${e.last_verified}`);
  }

  // Rule 4: topics and country are known.
  for (const t of e.topics) {
    if (!ctx.topics.has(t)) err('topics', `unknown topic "${t}"; add it to data/topics.yaml first`);
  }
  if (e.location && !regionOf(e.location.country)) {
    err(
      'location/country',
      `country "${e.location.country}" is not in the region table; add it to src/lib/regions.ts`,
    );
  }

  // Rule 6: urls are https and not blocked. (https is enforced by the schema.)
  for (const field of ['url', 'source_url'] as const) {
    const value = e[field];
    if (value && isBlocked(value, ctx.blockedHosts)) {
      err(field, `host of ${field} is on the blocklist in data/blocklist.yaml`);
    }
  }

  // Rule 7: no deadline after end_date.
  for (const d of e.deadlines ?? []) {
    if (compareISO(d.date, e.end_date) > 0) {
      err('deadlines', `${d.type} deadline ${d.date} falls after end_date ${e.end_date}`);
    }
  }

  // Rule 8: location required unless online.
  if (e.format !== 'online' && !e.location) {
    err('location', `location is required when format is "${e.format}"`);
  }

  // Warning 1: a deadline after the start date.
  for (const d of e.deadlines ?? []) {
    if (compareISO(d.date, e.start_date) > 0 && compareISO(d.date, e.end_date) <= 0) {
      warn('deadlines', `${d.type} deadline ${d.date} falls after the start date`);
    }
  }

  // Warning 2: stale verification for an event that has not started.
  if (compareISO(e.start_date, ctx.today) > 0 && daysBetween(e.last_verified, ctx.today) > 90) {
    warn('last_verified', `last verified more than 90 days ago (${e.last_verified})`);
  }

  // Warning 3: the description looks copied.
  if (e.description.length > 200 && !e.description.includes('.')) {
    warn('description', 'description looks copied: over 200 characters with no full stop');
  }

  // Warning 4: a bare homepage usually means the event page is not ready.
  try {
    const u = new URL(e.url);
    if (u.pathname === '/' && !u.search) {
      warn('url', 'url is a bare homepage with no path; link the event page if one exists');
    }
  } catch {
    // Malformed URLs are already a schema error.
  }
}
```

Replace the stub `validateCollection` with:

```ts
export function validateCollection(
  entries: EventFile[],
  _ctx: ValidationContext,
): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const byId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byTitleDate = new Map<string, string>();
  const byDescription = new Map<string, string>();

  for (const entry of entries) {
    const e = entry.data as RawEvent;
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue;

    const seenId = byId.get(e.id);
    if (seenId) {
      out.errors.push({ file: entry.file, field: 'id', message: `duplicate id, also in ${seenId}` });
    } else byId.set(e.id, entry.file);

    const url = e.url?.replace(/\/+$/, '');
    if (url) {
      const seenUrl = byUrl.get(url);
      if (seenUrl) {
        out.errors.push({
          file: entry.file,
          field: 'url',
          message: `duplicate url, also in ${seenUrl}`,
        });
      } else byUrl.set(url, entry.file);
    }

    const key = `${normaliseTitle(e.title ?? '')}|${e.start_date}`;
    const seenTitle = byTitleDate.get(key);
    if (seenTitle) {
      out.errors.push({
        file: entry.file,
        field: 'title',
        message: `duplicate title and start_date, also in ${seenTitle}`,
      });
    } else byTitleDate.set(key, entry.file);

    if (e.description) {
      const seenDesc = byDescription.get(e.description);
      if (seenDesc) {
        out.warnings.push({
          file: entry.file,
          field: 'description',
          message: `identical description to ${seenDesc}; write it in your own words`,
        });
      } else byDescription.set(e.description, entry.file);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/semantic-rules.test.ts`
Expected: PASS, 30 tests.

- [ ] **Step 5: Create the fixture corpus**

Each invalid fixture carries a comment naming the error it must trigger. Create under `tests/fixtures/valid/`:

`tests/fixtures/valid/2027/minimal-in-person-2027.yaml`:

```yaml
id: minimal-in-person-2027
title: Minimal In-Person Example Meeting
type: conference
start_date: 2027-05-03
end_date: 2027-05-05
format: in-person
location:
  city: Exampleville
  country: NL
url: https://example.org/minimal-2027/
topics: [dft]
description: A minimal valid in-person event used to exercise the happy path.
added: 2026-09-20
last_verified: 2026-09-20
fixture: true
```

`tests/fixtures/valid/2027/full-online-2027.yaml`:

```yaml
id: full-online-2027
title: Fully Populated Online Example Symposium
series: full-online-example
type: symposium
start_date: 2027-06-14
end_date: 2027-06-16
format: online
url: https://example.org/full-online-2027/programme/
source_url: https://example.org/full-online-2027/dates/
organizer: Example Society for Computational Chemistry
topics: [ml-potentials, molecular-dynamics, software-hpc]
description: Every optional field populated, with no location because the event is online.
deadlines:
  - type: abstract
    date: 2027-03-01
  - type: registration
    date: 2027-05-01
    timezone: UTC
    note: Late registration closes at 23:59 UTC.
status: scheduled
added: 2026-09-20
last_verified: 2026-09-20
fixture: true
```

`tests/fixtures/valid/2027/cancelled-2027.yaml`:

```yaml
id: cancelled-2027
title: Cancelled Example Workshop on Catalysis
type: workshop
start_date: 2027-09-01
end_date: 2027-09-03
format: hybrid
location:
  city: Exampleburg
  country: DE
url: https://example.org/cancelled-2027/
topics: [catalysis]
description: A cancelled event, which must stay listed and visibly marked.
status: cancelled
status_note: Cancelled by the organisers; see the official page.
added: 2026-09-20
last_verified: 2026-09-20
fixture: true
```

Create under `tests/fixtures/invalid/2027/` — one failure per file, each named by its comment:

```yaml
# EXPECTED ERROR: end_date is before start_date
id: end-before-start-2027
title: Invalid Example with Reversed Dates
type: conference
start_date: 2027-04-10
end_date: 2027-04-08
format: online
url: https://example.org/end-before-start-2027/
topics: [dft]
description: The end date precedes the start date.
added: 2026-09-20
last_verified: 2026-09-20
fixture: true
```

Repeat the same shape for these files, changing only the field named in each comment:

| File | Comment and the change that triggers it |
|---|---|
| `id-mismatch-2027.yaml` | `# EXPECTED ERROR: id must equal the file name stem` — set `id: something-else-2027` |
| `wrong-year-folder-2027.yaml` | `# EXPECTED ERROR: file must sit in the folder for its start year` — place it in `tests/fixtures/invalid/2026/` with `start_date: 2027-04-10` |
| `future-verified-2027.yaml` | `# EXPECTED ERROR: last_verified is in the future` — set `last_verified: 2099-01-01` |
| `added-after-verified-2027.yaml` | `# EXPECTED ERROR: added is after last_verified` — `added: 2026-09-20`, `last_verified: 2026-09-19` |
| `unknown-topic-2027.yaml` | `# EXPECTED ERROR: unknown topic` — `topics: [quantum-astrology]` |
| `unknown-country-2027.yaml` | `# EXPECTED ERROR: country is not in the region table` — `location: {city: X, country: ZZ}` |
| `http-url-2027.yaml` | `# EXPECTED ERROR: url must be https` — `url: http://example.org/x/` |
| `deadline-after-end-2027.yaml` | `# EXPECTED ERROR: deadline falls after end_date` — a deadline dated after `end_date` |
| `missing-location-2027.yaml` | `# EXPECTED ERROR: location is required when format is in-person` — `format: in-person`, no `location` |
| `too-many-topics-2027.yaml` | `# EXPECTED ERROR: more than five topics` — six valid slugs |
| `long-description-2027.yaml` | `# EXPECTED ERROR: description over 280 characters` — a 281-character description |
| `cancelled-no-note-2027.yaml` | `# EXPECTED ERROR: status_note required when status is cancelled` — `status: cancelled`, no `status_note` |

- [ ] **Step 6: Write the fixture-corpus test**

Create `tests/fixtures/fixtures.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

const ctx = loadValidationContext('.', '2026-09-20');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .map((p) => join(dir, p));
}

describe('valid fixtures', () => {
  for (const path of filesUnder('tests/fixtures/valid')) {
    it(`${path} has no errors`, () => {
      const data = parse(readFileSync(path, 'utf8'));
      const r = validateEvent({ file: path, data }, ctx);
      expect(r.errors).toEqual([]);
    });
  }
});

describe('invalid fixtures', () => {
  for (const path of filesUnder('tests/fixtures/invalid')) {
    it(`${path} reports the error named in its comment`, () => {
      const source = readFileSync(path, 'utf8');
      const expected = /^# EXPECTED ERROR: (.+)$/m.exec(source)?.[1];
      expect(expected, `${path} is missing its "# EXPECTED ERROR:" comment`).toBeDefined();

      const r = validateEvent({ file: path, data: parse(source) }, ctx);
      expect(r.errors.length, `${path} produced no errors`).toBeGreaterThan(0);

      // Match on the distinctive words of the comment, so wording can evolve
      // without the test becoming brittle.
      const haystack = r.errors.map((e) => `${e.field} ${e.message}`).join(' ').toLowerCase();
      const keywords = (expected ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);
      expect(keywords.some((w) => haystack.includes(w)), `${path}: expected "${expected}", got: ${haystack}`).toBe(true);
    });
  }
});
```

- [ ] **Step 7: Run the whole suite and every gate**

Run: `npx vitest run`
Expected: PASS. Every valid fixture clean; every invalid fixture reporting its named error.

Run: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validation.ts tests/lib/semantic-rules.test.ts tests/fixtures/
git commit -m "feat: enforce the eight semantic rules and four warnings

Adds per-event rules (id/file/year agreement, date ordering, verification
sanity, vocabulary, blocklist, deadline bounds, location) and collection-level
duplicate detection. Warnings report without failing the run.

Adds a fixture corpus where each invalid file names the error it must trigger
and a test asserts it is reported."
```

---
## Task 7: The event loader

The single place pages and feeds get data. Everything downstream depends on this module's output shape.

**Files:**
- Create: `src/lib/events.ts`, `tests/lib/events.test.ts`

**Interfaces:**
- Consumes: `validateEvent`, `validateCollection`, `loadValidationContext`, `formatProblems` from `src/lib/validation.ts`; `compareISO`, `todayUTC` from `src/lib/dates.ts`; `regionOf` from `src/lib/regions.ts`; `LoadedEvent`, `RawEvent`, `DerivedStatus`, `Deadline` from `src/lib/types.ts`.
- Produces:
  - `interface LoadOptions { eventsDir?: string; today?: ISODate; includeFixtures?: boolean }`
  - `deriveStatus(event: RawEvent, today: ISODate): DerivedStatus`
  - `loadEvents(options?: LoadOptions): LoadedEvent[]`
  - `upcomingEvents(events: LoadedEvent[]): LoadedEvent[]` — `upcoming` and `ongoing`, in that order of start date
  - `pastEvents(events: LoadedEvent[]): LoadedEvent[]` — newest first
  - `eventById(events: LoadedEvent[], id: string): LoadedEvent | undefined`
  - `interface UpcomingDeadline { event: LoadedEvent; deadline: Deadline }`
  - `upcomingDeadlines(events: LoadedEvent[], today: ISODate): UpcomingDeadline[]` — soonest first
  - `hasOpenDeadline(event: LoadedEvent, today: ISODate): boolean`
  - `isStale(event: LoadedEvent, today: ISODate): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveStatus,
  eventById,
  hasOpenDeadline,
  isStale,
  loadEvents,
  pastEvents,
  upcomingDeadlines,
  upcomingEvents,
} from '../../src/lib/events';
import type { RawEvent } from '../../src/lib/types';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };

const stub = (over: Partial<RawEvent>): RawEvent =>
  ({
    id: 'x-2027',
    title: 'X',
    type: 'conference',
    start_date: '2027-01-10',
    end_date: '2027-01-12',
    format: 'online',
    url: 'https://example.org/x/',
    topics: ['dft'],
    description: 'd',
    added: '2026-09-20',
    last_verified: '2026-09-20',
    ...over,
  }) as RawEvent;

describe('deriveStatus', () => {
  it('is upcoming before the start date', () => {
    expect(deriveStatus(stub({ start_date: '2026-10-01', end_date: '2026-10-03' }), '2026-09-20')).toBe(
      'upcoming',
    );
  });

  it('is ongoing on the first day', () => {
    expect(deriveStatus(stub({ start_date: '2026-09-20', end_date: '2026-09-22' }), '2026-09-20')).toBe(
      'ongoing',
    );
  });

  it('is ongoing on the last day', () => {
    expect(deriveStatus(stub({ start_date: '2026-09-18', end_date: '2026-09-20' }), '2026-09-20')).toBe(
      'ongoing',
    );
  });

  it('is past the day after it ends', () => {
    expect(deriveStatus(stub({ start_date: '2026-09-17', end_date: '2026-09-19' }), '2026-09-20')).toBe(
      'past',
    );
  });
});

describe('loadEvents', () => {
  it('loads every valid fixture', () => {
    expect(loadEvents(opts)).toHaveLength(3);
  });

  it('sorts by start date ascending', () => {
    const dates = loadEvents(opts).map((e) => e.start_date);
    expect([...dates]).toEqual([...dates].sort());
  });

  it('derives Online as the region for online events', () => {
    const e = eventById(loadEvents(opts), 'full-online-2027');
    expect(e?.region).toBe('Online');
  });

  it('derives the geographic region for located events', () => {
    const e = eventById(loadEvents(opts), 'minimal-in-person-2027');
    expect(e?.region).toBe('Europe');
  });

  it('derives the region for a hybrid event from its country', () => {
    const e = eventById(loadEvents(opts), 'cancelled-2027');
    expect(e?.region).toBe('Europe');
  });

  it('drops fixtures when includeFixtures is false', () => {
    expect(loadEvents({ ...opts, includeFixtures: false })).toHaveLength(0);
  });

  it('throws on invalid data rather than skipping it', () => {
    expect(() => loadEvents({ ...opts, eventsDir: 'tests/fixtures/invalid' })).toThrow(
      /validation failed/i,
    );
  });

  it('returns an empty list for a directory that does not exist', () => {
    expect(loadEvents({ ...opts, eventsDir: 'tests/fixtures/nope' })).toEqual([]);
  });
});

describe('selectors', () => {
  const events = loadEvents(opts);

  it('upcomingEvents excludes past events', () => {
    expect(upcomingEvents(events).every((e) => e.status_derived !== 'past')).toBe(true);
  });

  it('pastEvents is newest first', () => {
    const past = pastEvents(events);
    for (let i = 1; i < past.length; i += 1) {
      expect(past[i - 1]!.start_date >= past[i]!.start_date).toBe(true);
    }
  });

  it('upcomingDeadlines is sorted soonest first and excludes passed ones', () => {
    const ds = upcomingDeadlines(events, '2026-09-20');
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(d.deadline.date >= '2026-09-20').toBe(true);
    for (let i = 1; i < ds.length; i += 1) {
      expect(ds[i - 1]!.deadline.date <= ds[i]!.deadline.date).toBe(true);
    }
  });

  it('upcomingDeadlines excludes cancelled events', () => {
    const ds = upcomingDeadlines(events, '2026-09-20');
    expect(ds.some((d) => d.event.status === 'cancelled')).toBe(false);
  });
});

describe('hasOpenDeadline', () => {
  const events = loadEvents(opts);

  it('is true when a deadline is today or later', () => {
    const e = eventById(events, 'full-online-2027')!;
    expect(hasOpenDeadline(e, '2026-09-20')).toBe(true);
  });

  it('is false once every deadline has passed', () => {
    const e = eventById(events, 'full-online-2027')!;
    expect(hasOpenDeadline(e, '2027-05-02')).toBe(false);
  });

  it('is false for an event with no deadlines', () => {
    const e = eventById(events, 'minimal-in-person-2027')!;
    expect(hasOpenDeadline(e, '2026-09-20')).toBe(false);
  });
});

describe('isStale', () => {
  const events = loadEvents(opts);

  it('is false when recently verified', () => {
    expect(isStale(events[0]!, '2026-09-20')).toBe(false);
  });

  it('is true more than 90 days after last_verified, before the event starts', () => {
    expect(isStale(events[0]!, '2027-01-05')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/events.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/events`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/events.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compareISO, daysBetween, todayUTC, type ISODate } from './dates';
import { regionOf } from './regions';
import {
  formatProblems,
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationResult,
} from './validation';
import type { Deadline, DerivedStatus, LoadedEvent, RawEvent } from './types';

export interface LoadOptions {
  /** Directory holding `<year>/<id>.yaml`. Defaults to `data/events`. */
  eventsDir?: string;
  /** The build date, as a UTC calendar date. Defaults to today. */
  today?: ISODate;
  /** Defaults to false in production builds, true otherwise. */
  includeFixtures?: boolean;
}

export interface UpcomingDeadline {
  event: LoadedEvent;
  deadline: Deadline;
}

export function deriveStatus(event: RawEvent, today: ISODate): DerivedStatus {
  if (compareISO(event.end_date, today) < 0) return 'past';
  if (compareISO(event.start_date, today) > 0) return 'upcoming';
  return 'ongoing';
}

function readAll(dir: string): EventFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: join(dir, p).split('\\').join('/'),
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

let cached: LoadedEvent[] | undefined;

export function loadEvents(options: LoadOptions = {}): LoadedEvent[] {
  const eventsDir = options.eventsDir ?? 'data/events';
  const today = options.today ?? todayUTC();
  const includeFixtures = options.includeFixtures ?? process.env.NODE_ENV !== 'production';
  const isDefault =
    options.eventsDir === undefined &&
    options.today === undefined &&
    options.includeFixtures === undefined;

  if (isDefault && cached) return cached;

  const entries = readAll(eventsDir);
  const ctx = loadValidationContext('.', today);
  const all: ValidationResult = { errors: [], warnings: [] };

  for (const entry of entries) {
    const r = validateEvent(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  const collection = validateCollection(entries, ctx);
  all.errors.push(...collection.errors);
  all.warnings.push(...collection.warnings);

  if (all.errors.length > 0) {
    throw new Error(`event data validation failed:\n${formatProblems(all)}`);
  }
  for (const w of all.warnings) {
    console.warn(`WARN ${w.file}: ${w.field}: ${w.message}`);
  }

  const events = entries
    .map((entry) => entry.data as RawEvent)
    .filter((e) => includeFixtures || e.fixture !== true)
    .map<LoadedEvent>((e) => ({
      ...e,
      region: e.format === 'online' || !e.location ? 'Online' : (regionOf(e.location.country) ?? 'Online'),
      status_derived: deriveStatus(e, today),
    }))
    .sort((a, b) => compareISO(a.start_date, b.start_date) || a.title.localeCompare(b.title));

  if (isDefault) cached = events;
  return events;
}

export function upcomingEvents(events: LoadedEvent[]): LoadedEvent[] {
  return events.filter((e) => e.status_derived !== 'past');
}

export function pastEvents(events: LoadedEvent[]): LoadedEvent[] {
  return events
    .filter((e) => e.status_derived === 'past')
    .sort((a, b) => compareISO(b.start_date, a.start_date));
}

export function eventById(events: LoadedEvent[], id: string): LoadedEvent | undefined {
  return events.find((e) => e.id === id);
}

export function hasOpenDeadline(event: LoadedEvent, today: ISODate): boolean {
  return (event.deadlines ?? []).some((d) => compareISO(d.date, today) >= 0);
}

export function upcomingDeadlines(events: LoadedEvent[], today: ISODate): UpcomingDeadline[] {
  return events
    .filter((e) => e.status !== 'cancelled' && e.status_derived !== 'past')
    .flatMap((event) =>
      (event.deadlines ?? [])
        .filter((deadline) => compareISO(deadline.date, today) >= 0)
        .map((deadline) => ({ event, deadline })),
    )
    .sort(
      (a, b) =>
        compareISO(a.deadline.date, b.deadline.date) || a.event.title.localeCompare(b.event.title),
    );
}

/** True when the dates need re-checking: unverified for 90 days and not yet started. */
export function isStale(event: LoadedEvent, today: ISODate): boolean {
  return compareISO(event.start_date, today) > 0 && daysBetween(event.last_verified, today) > 90;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/events.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/events.ts tests/lib/events.test.ts
git commit -m "feat: add the single event loader

Parses, validates, drops fixtures in production builds, sorts, and derives
status and region. Throws on invalid data so a build cannot ship it. Adds
selectors for upcoming, past, deadlines, open-deadline and staleness."
```

---

## Task 8: Seed data

Spec D3: three `fixture: true` events plus 10-15 verified real ones. **This task has a hard rule: never invent an event.** If you cannot open the organiser's page and read the dates yourself, leave the event out and say so in your report.

**Files:**
- Create: `data/events/2026/*.yaml`, `data/events/2027/*.yaml`

**Interfaces:**
- Consumes: the schema and validator from Tasks 4-6.
- Produces: the dataset every page and feed renders.

- [ ] **Step 1: Write the three development fixtures**

These use `example.org` URLs and `fixture: true`, so they never reach production. Copy the three files from `tests/fixtures/valid/2027/` into `data/events/2027/`:

```bash
mkdir -p data/events/2026 data/events/2027
cp tests/fixtures/valid/2027/*.yaml data/events/2027/
npm run validate
```

Expected: 3 files, 0 errors.

- [ ] **Step 2: Build the candidate list from the sources the project already names**

`docs/discovery-agent.md` lists the seed sources. Fetch each listing page and collect links to **upcoming** events (start date after 2026-09-20):

- CECAM — https://www.cecam.org/
- Psi-k — https://psi-k.net/
- Gordon Research Conferences — https://www.grc.org/
- EuChemS Division of Computational and Theoretical Chemistry — https://www.euchems.eu/divisions/computational-chemistry-2/conferences/
- CCL.net conference announcements — https://ccl.net/
- Also locate: MolSSI, ICTP calendar, Telluride Science, WATOC

Do **not** scrape or republish another aggregator's curation. `labinitio.org` is named in `docs/discovery-agent.md` for coverage comparison only.

- [ ] **Step 3: For each candidate, open the organiser's own page and record what you actually read**

For every event, you must have read these from the official page: title, type, start and end dates, format, city and country, organiser, any deadlines with their timezone. Then:

- `url` — the event page you read.
- `source_url` — only if the dates came from a different page on the organiser's own site.
- `description` — **your own words**, 280 characters or fewer, plain text. Do not paste the organiser's copy (AGENTS.md rule 2).
- `topics` — 1-5 slugs from `data/topics.yaml`. Do not invent slugs; if nothing fits, the event probably does not belong (see `docs/curation-policy.md`).
- `added` and `last_verified` — today's actual date.
- `id` — lowercase slug ending in the start year, matching the file name, in the folder for that year.

Apply the inclusion criteria from `docs/curation-policy.md` before adding: an official page, an identifiable organising body, a scientific programme, transparent costs. Skip anything that fails, and note it.

- [ ] **Step 4: Write one file per event and validate continuously**

```bash
npm run validate
```

Fix every error. Warnings are informational, but investigate each one — a "bare homepage" warning usually means you linked the society rather than the event, and a "description looks copied" warning means rewrite it.

- [ ] **Step 5: Confirm the dataset exercises every code path**

The set must include, across the 10-15 events: at least one `online`, one `hybrid` and several `in-person`; at least three distinct regions; at least four distinct `type` values; at least five events carrying `deadlines`; and at least one event in 2026 plus several in 2027.

If the real events you verified do not cover all of these, that is fine — say so in your report rather than inventing an event to fill a gap.

```bash
npm run validate && npm test && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add data/events/
git commit -m "feat: add seed events

Three fixture:true development events plus real upcoming events verified
against each organiser's official page on the recorded last_verified date.
Descriptions are written in our own words."
```

- [ ] **Step 7: Merge phase 1**

```bash
git checkout main
git merge --no-ff feat/phase-1-data-layer -m "feat: phase 1 — data layer

Schema, controlled vocabulary, validator with semantic rules, the loader,
fixture corpus and seed events."
```

---
## Task 9: Design system and base layout

Phase 2. Branch: `feat/phase-2-pages` (create it now; tasks 9-14 land on it).

Spec §8, "Isosurface". Spec D2 rules out webfonts, so colour, density and structure carry the aesthetic.

**Files:**
- Create: `src/styles/global.css`, `src/layouts/Base.astro`

**Interfaces:**
- Consumes: `site` from `site.config.ts`.
- Produces: `Base.astro` with props `{ title: string; description: string; path: string; ogType?: string }`. Every page uses it. CSS classes `.wrap`, `.rail`, `.reveal`, `.mono`, `.pill`, `.rule`, `.muted`, `.warn` are the shared vocabulary later tasks reference.

- [ ] **Step 1: Create the branch and write `src/styles/global.css`**

```bash
git checkout -b feat/phase-2-pages
mkdir -p src/styles src/layouts src/components src/scripts
```

```css
/* Isosurface — dark-first editorial grid. Spec section 8.
   System fonts only (spec D2). No webfonts, no external requests. */

:root {
  color-scheme: dark light;

  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono',
    monospace;

  --step--1: clamp(0.78rem, 0.76rem + 0.1vw, 0.84rem);
  --step-0: clamp(0.95rem, 0.92rem + 0.15vw, 1.05rem);
  --step-1: clamp(1.12rem, 1.02rem + 0.5vw, 1.35rem);
  --step-2: clamp(1.4rem, 1.2rem + 1vw, 1.95rem);
  --step-3: clamp(1.85rem, 1.45rem + 2vw, 2.9rem);

  --space-xs: 0.375rem;
  --space-s: 0.75rem;
  --space-m: 1.25rem;
  --space-l: 2rem;
  --space-xl: 3.5rem;

  --measure: 68ch;
  --radius: 2px;

  /* Dark theme: deep desaturated blue-black with orbital-phase accents. */
  --bg: #0a0e13;
  --bg-raise: #111922;
  --fg: #dde5ed;
  --fg-muted: #8697a6;
  --rule: #1d2833;
  --rule-strong: #2c3c4b;
  --warm: #f2a950;
  --warm-soft: #3a2a14;
  --cool: #58d6c8;
  --cool-soft: #133733;
}

@media (prefers-color-scheme: light) {
  :root {
    /* Warm paper, never white. */
    --bg: #f5f1e8;
    --bg-raise: #fffdf7;
    --fg: #1a2127;
    --fg-muted: #54616b;
    --rule: #ded6c6;
    --rule-strong: #c3b8a3;
    --warm: #9c4f14;
    --warm-soft: #f0e0cb;
    --cool: #0c645c;
    --cool-soft: #d3e8e4;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--step-0);
  line-height: 1.6;
  color: var(--fg);
  background-color: var(--bg);
  /* Atmosphere: two low-contrast density lobes. Pure CSS, no image bytes. */
  background-image:
    radial-gradient(
      58% 38% at 10% -6%,
      color-mix(in oklab, var(--cool) 13%, transparent),
      transparent 70%
    ),
    radial-gradient(
      48% 32% at 94% 6%,
      color-mix(in oklab, var(--warm) 10%, transparent),
      transparent 70%
    );
  background-attachment: fixed;
  background-repeat: no-repeat;
}

h1,
h2,
h3 {
  line-height: 1.15;
  letter-spacing: -0.02em;
  font-weight: 650;
  margin: 0 0 var(--space-s);
  text-wrap: balance;
}

h1 {
  font-size: var(--step-3);
}
h2 {
  font-size: var(--step-2);
}
h3 {
  font-size: var(--step-1);
}

p {
  margin: 0 0 var(--space-s);
  max-width: var(--measure);
}

a {
  color: var(--cool);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.18em;
}

a:hover {
  text-decoration-thickness: 2px;
}

:focus-visible {
  outline: 2px solid var(--warm);
  outline-offset: 2px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--step--1);
  letter-spacing: -0.01em;
}

.muted {
  color: var(--fg-muted);
}

.wrap {
  width: min(100% - 2rem, 78rem);
  margin-inline: auto;
  padding-block: var(--space-l);
}

.rule {
  border: 0;
  border-top: 1px solid var(--rule);
  margin-block: var(--space-m);
}

/* Skip link */
.skip {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--bg-raise);
  color: var(--fg);
  padding: var(--space-s) var(--space-m);
  z-index: 10;
}
.skip:focus {
  left: var(--space-s);
  top: var(--space-s);
}

/* Header and footer */
.site-head,
.site-foot {
  border-block-end: 1px solid var(--rule);
}
.site-foot {
  border-block: 1px solid var(--rule);
  border-block-end: 0;
  margin-block-start: var(--space-xl);
  color: var(--fg-muted);
  font-size: var(--step--1);
}
.site-head__inner,
.site-foot__inner {
  width: min(100% - 2rem, 78rem);
  margin-inline: auto;
  padding-block: var(--space-m);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-m);
  align-items: baseline;
  justify-content: space-between;
}
.site-head__name {
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--fg);
  text-decoration: none;
}
.site-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-m);
  font-size: var(--step--1);
}
.site-nav a {
  color: var(--fg-muted);
  text-decoration: none;
}
.site-nav a:hover,
.site-nav a[aria-current='page'] {
  color: var(--fg);
  text-decoration: underline;
  text-underline-offset: 0.3em;
}

/* Two-column layout: filter rail plus results. */
.rail {
  display: grid;
  grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
  gap: var(--space-xl);
  align-items: start;
}

@media (max-width: 52rem) {
  .rail {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-m);
  }
}

/* Pills: topics and status markers. */
.pill {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: var(--step--1);
  padding: 0.1em 0.5em;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  color: var(--fg-muted);
  background: var(--bg-raise);
}
.pill--topic {
  border-color: color-mix(in oklab, var(--cool) 45%, var(--rule));
  color: var(--cool);
  background: var(--cool-soft);
}
.pill--deadline {
  border-color: color-mix(in oklab, var(--warm) 45%, var(--rule));
  color: var(--warm);
  background: var(--warm-soft);
}
.pill--status {
  border-color: var(--warm);
  color: var(--warm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.warn {
  border-inline-start: 2px solid var(--warm);
  padding-inline-start: var(--space-s);
  color: var(--fg-muted);
  font-size: var(--step--1);
}

/* Staggered load-in. Motion is opt-out by default. */
@media (prefers-reduced-motion: no-preference) {
  .reveal > * {
    animation: rise 420ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards;
  }
  .reveal > *:nth-child(1) {
    animation-delay: 30ms;
  }
  .reveal > *:nth-child(2) {
    animation-delay: 60ms;
  }
  .reveal > *:nth-child(3) {
    animation-delay: 90ms;
  }
  .reveal > *:nth-child(4) {
    animation-delay: 120ms;
  }
  .reveal > *:nth-child(5) {
    animation-delay: 150ms;
  }
  .reveal > *:nth-child(6) {
    animation-delay: 180ms;
  }
  .reveal > *:nth-child(n + 7) {
    animation-delay: 210ms;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

[hidden] {
  display: none !important;
}
```

- [ ] **Step 2: Write `src/layouts/Base.astro`**

```astro
---
import { site } from '../../site.config';
import '../styles/global.css';

interface Props {
  title: string;
  description: string;
  /** Route path with leading and trailing slashes, e.g. `/deadlines/`. */
  path: string;
}

const { title, description, path } = Astro.props;
const canonical = new URL(path, site.url).href;
const fullTitle = path === '/' ? `${site.name} — ${site.tagline}` : `${title} — ${site.name}`;

const nav = [
  { href: '/', label: 'Events' },
  { href: '/deadlines/', label: 'Deadlines' },
  { href: '/archive/', label: 'Archive' },
  { href: '/submit/', label: 'Add an event' },
  { href: '/policy/', label: 'Policy' },
  { href: '/about/', label: 'About' },
];
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{fullTitle}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={canonical} />
    <meta property="og:type" content="website" />
    <meta property="og:title" content={fullTitle} />
    <meta property="og:description" content={description} />
    <meta property="og:url" content={canonical} />
    <meta property="og:site_name" content={site.name} />
    <meta name="twitter:card" content="summary" />
    <link rel="alternate" type="application/atom+xml" title={`${site.name} — new events`} href="/feed.xml" />
    <link rel="sitemap" href="/sitemap.xml" />
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-head">
      <div class="site-head__inner">
        <a class="site-head__name" href="/">{site.name}</a>
        <nav class="site-nav" aria-label="Main">
          {
            nav.map((item) => (
              <a href={item.href} aria-current={item.href === path ? 'page' : undefined}>
                {item.label}
              </a>
            ))
          }
        </nav>
      </div>
    </header>

    <main id="main" class="wrap">
      <slot />
    </main>

    <footer class="site-foot">
      <div class="site-foot__inner">
        <p class="muted">
          Community-maintained. Listings follow the <a href="/policy/">curation policy</a>.
        </p>
        <p class="muted">
          <a href="/events.ics">Calendar</a> · <a href="/feed.xml">Feed</a> ·
          <a href="/events.json">JSON</a> · <a href={site.repoUrl}>Source</a>
        </p>
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 3: Verify it builds and renders**

Run: `npm run build && npm run typecheck`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css src/layouts/Base.astro
git commit -m "feat: add the Isosurface design system and base layout

Dark-first editorial grid with warm-paper light theme, orbital-phase accents
and a CSS-only density-lobe background. System fonts only per spec D2.
Staggered load-in behind prefers-reduced-motion."
```

---

## Task 10: Pure filter logic

The filter rules live here, not in the island, so they are testable without a DOM and shared between the server-rendered page and the client.

**Files:**
- Create: `src/lib/filter.ts`, `tests/lib/filter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface FilterState { q: string; topics: string[]; region: string; country: string; format: string; type: string; from: string; to: string; deadline: boolean }`
  - `EMPTY_FILTER: FilterState`
  - `interface FilterRow { search: string; topics: string[]; region: string; country: string; format: string; type: string; start: string; end: string; openDeadline: boolean }`
  - `parseFilterState(params: URLSearchParams): FilterState`
  - `serialiseFilterState(state: FilterState): URLSearchParams`
  - `isEmptyFilter(state: FilterState): boolean`
  - `matchesFilter(row: FilterRow, state: FilterState): boolean`
  - `rowFromDataset(dataset: Record<string, string | undefined>): FilterRow`

Spec D4: OR within a category, AND across categories. Date range is overlap — an event matches if it has not finished before `from` and has not started after `to`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  isEmptyFilter,
  matchesFilter,
  parseFilterState,
  rowFromDataset,
  serialiseFilterState,
  type FilterRow,
} from '../../src/lib/filter';

const row: FilterRow = {
  search: 'excited-state methods example institute exampleville',
  topics: ['excited-states', 'dft'],
  region: 'Europe',
  country: 'NL',
  format: 'in-person',
  type: 'workshop',
  start: '2027-03-08',
  end: '2027-03-10',
  openDeadline: true,
};

describe('parseFilterState', () => {
  it('reads every parameter', () => {
    const s = parseFilterState(
      new URLSearchParams(
        'q=dft&topics=dft,catalysis&region=Europe&country=DE&format=hybrid&type=school&from=2027-01-01&to=2027-12-31&deadline=open',
      ),
    );
    expect(s).toEqual({
      q: 'dft',
      topics: ['dft', 'catalysis'],
      region: 'Europe',
      country: 'DE',
      format: 'hybrid',
      type: 'school',
      from: '2027-01-01',
      to: '2027-12-31',
      deadline: true,
    });
  });

  it('returns the empty state for no parameters', () => {
    expect(parseFilterState(new URLSearchParams())).toEqual(EMPTY_FILTER);
  });

  it('drops empty topic entries', () => {
    expect(parseFilterState(new URLSearchParams('topics=,dft,')).topics).toEqual(['dft']);
  });
});

describe('serialiseFilterState', () => {
  it('omits empty values so a clean view stays at /', () => {
    expect(serialiseFilterState(EMPTY_FILTER).toString()).toBe('');
  });

  it('round-trips', () => {
    const s = parseFilterState(new URLSearchParams('q=dft&topics=dft,catalysis&deadline=open'));
    expect(parseFilterState(serialiseFilterState(s))).toEqual(s);
  });

  it('writes topics as a comma-separated list', () => {
    const params = serialiseFilterState({ ...EMPTY_FILTER, topics: ['dft', 'catalysis'] });
    expect(params.get('topics')).toBe('dft,catalysis');
  });
});

describe('isEmptyFilter', () => {
  it('is true for the empty state', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
  });

  it('is false once anything is set', () => {
    expect(isEmptyFilter({ ...EMPTY_FILTER, deadline: true })).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('matches everything when nothing is set', () => {
    expect(matchesFilter(row, EMPTY_FILTER)).toBe(true);
  });

  it('matches free text case-insensitively', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, q: 'EXAMPLE' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, q: 'catalysis' })).toBe(false);
  });

  it('ORs within topics', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['catalysis', 'dft'] })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['catalysis'] })).toBe(false);
  });

  it('ANDs across categories', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['dft'], format: 'in-person' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, topics: ['dft'], format: 'online' })).toBe(false);
  });

  it('filters by region, country and type', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, region: 'Europe' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, region: 'Asia' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, country: 'NL' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, country: 'DE' })).toBe(false);
    expect(matchesFilter(row, { ...EMPTY_FILTER, type: 'workshop' })).toBe(true);
    expect(matchesFilter(row, { ...EMPTY_FILTER, type: 'school' })).toBe(false);
  });

  it('treats the date range as an overlap', () => {
    // Window ends before the event starts.
    expect(matchesFilter(row, { ...EMPTY_FILTER, to: '2027-03-07' })).toBe(false);
    // Window starts after the event ends.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-03-11' })).toBe(false);
    // Window clips the event's first day.
    expect(matchesFilter(row, { ...EMPTY_FILTER, to: '2027-03-08' })).toBe(true);
    // Window clips the event's last day.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-03-10' })).toBe(true);
    // Window fully contains the event.
    expect(matchesFilter(row, { ...EMPTY_FILTER, from: '2027-01-01', to: '2027-12-31' })).toBe(true);
  });

  it('filters by open deadline', () => {
    expect(matchesFilter(row, { ...EMPTY_FILTER, deadline: true })).toBe(true);
    expect(matchesFilter({ ...row, openDeadline: false }, { ...EMPTY_FILTER, deadline: true })).toBe(
      false,
    );
  });
});

describe('rowFromDataset', () => {
  it('reads the data attributes the server renders', () => {
    const parsed = rowFromDataset({
      search: 'Some Title',
      topics: 'dft catalysis',
      region: 'Europe',
      country: 'DE',
      format: 'hybrid',
      type: 'school',
      start: '2027-01-01',
      end: '2027-01-03',
      deadline: 'open',
    });
    expect(parsed.topics).toEqual(['dft', 'catalysis']);
    expect(parsed.openDeadline).toBe(true);
    expect(parsed.search).toBe('some title');
  });

  it('tolerates missing attributes', () => {
    const parsed = rowFromDataset({});
    expect(parsed.topics).toEqual([]);
    expect(parsed.openDeadline).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/filter.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/filter`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/filter.ts`:

```ts
export interface FilterState {
  q: string;
  topics: string[];
  region: string;
  country: string;
  format: string;
  type: string;
  /** Inclusive lower bound of the date window, ISO `YYYY-MM-DD`. */
  from: string;
  /** Inclusive upper bound of the date window, ISO `YYYY-MM-DD`. */
  to: string;
  deadline: boolean;
}

export const EMPTY_FILTER: FilterState = {
  q: '',
  topics: [],
  region: '',
  country: '',
  format: '',
  type: '',
  from: '',
  to: '',
  deadline: false,
};

/** The shape the server encodes into each row's data attributes. */
export interface FilterRow {
  /** Lowercased title, organiser and city, concatenated. */
  search: string;
  topics: string[];
  region: string;
  country: string;
  format: string;
  type: string;
  start: string;
  end: string;
  openDeadline: boolean;
}

export function parseFilterState(params: URLSearchParams): FilterState {
  return {
    q: params.get('q')?.trim() ?? '',
    topics: (params.get('topics') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    region: params.get('region') ?? '',
    country: params.get('country') ?? '',
    format: params.get('format') ?? '',
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    deadline: params.get('deadline') === 'open',
  };
}

export function serialiseFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.topics.length > 0) params.set('topics', state.topics.join(','));
  if (state.region) params.set('region', state.region);
  if (state.country) params.set('country', state.country);
  if (state.format) params.set('format', state.format);
  if (state.type) params.set('type', state.type);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  if (state.deadline) params.set('deadline', 'open');
  return params;
}

export function isEmptyFilter(state: FilterState): boolean {
  return serialiseFilterState(state).toString() === '';
}

/**
 * Spec D4: OR within a category, AND across categories.
 * The date window is an overlap test, not containment.
 */
export function matchesFilter(row: FilterRow, state: FilterState): boolean {
  if (state.q && !row.search.includes(state.q.toLowerCase())) return false;
  if (state.topics.length > 0 && !state.topics.some((t) => row.topics.includes(t))) return false;
  if (state.region && row.region !== state.region) return false;
  if (state.country && row.country !== state.country) return false;
  if (state.format && row.format !== state.format) return false;
  if (state.type && row.type !== state.type) return false;
  if (state.from && row.end < state.from) return false;
  if (state.to && row.start > state.to) return false;
  if (state.deadline && !row.openDeadline) return false;
  return true;
}

export function rowFromDataset(dataset: Record<string, string | undefined>): FilterRow {
  return {
    search: (dataset.search ?? '').toLowerCase(),
    topics: (dataset.topics ?? '').split(/\s+/).filter(Boolean),
    region: dataset.region ?? '',
    country: dataset.country ?? '',
    format: dataset.format ?? '',
    type: dataset.type ?? '',
    start: dataset.start ?? '',
    end: dataset.end ?? '',
    openDeadline: dataset.deadline === 'open',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/filter.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/filter.ts tests/lib/filter.test.ts
git commit -m "feat: add pure filter logic shared by page and island

OR within a category, AND across categories, with the date window treated as
an overlap. Kept DOM-free so it is unit-testable and reusable client-side."
```

---
## Task 11: Home page, event row and the filter island

**Files:**
- Modify: `src/lib/dates.ts` (add display formatting), `tests/lib/dates.test.ts`
- Create: `src/components/EventRow.astro`, `src/scripts/filters.ts`
- Replace: `src/pages/index.astro` (the stub from Task 1)

**Interfaces:**
- Consumes: `loadEvents`, `upcomingEvents`, `hasOpenDeadline`, `isStale` from `src/lib/events.ts`; everything from `src/lib/filter.ts`; `Base.astro`.
- Produces:
  - `formatDate(d: ISODate): string` and `formatDateRange(start: ISODate, end: ISODate): string` added to `src/lib/dates.ts`
  - `EventRow.astro` with props `{ event: LoadedEvent; today: ISODate }`
  - The DOM contract the island depends on: `#filters`, `#event-list`, `li.event` with `data-search|topics|region|country|format|type|start|end|deadline`, `#result-count`, `#clear-filters`

**Progressive enhancement decision.** The filter form is rendered with `hidden` and unhidden by the island. Without JavaScript the visitor sees the complete, correctly-ordered list and no controls, rather than controls that silently do nothing. A `<noscript>` note explains why.

- [ ] **Step 1: Write the failing test for date formatting**

Append to `tests/lib/dates.test.ts`:

```ts
import { formatDate, formatDateRange } from '../../src/lib/dates';

describe('formatDate', () => {
  it('formats in UTC, never the local timezone', () => {
    expect(formatDate('2027-03-08')).toBe('8 Mar 2027');
  });

  it('formats the first of January without slipping a year', () => {
    expect(formatDate('2027-01-01')).toBe('1 Jan 2027');
  });
});

describe('formatDateRange', () => {
  it('collapses a single-day event', () => {
    expect(formatDateRange('2027-03-08', '2027-03-08')).toBe('8 Mar 2027');
  });

  it('collapses the month when both dates share it', () => {
    expect(formatDateRange('2027-03-08', '2027-03-10')).toBe('8–10 Mar 2027');
  });

  it('keeps both months within one year', () => {
    expect(formatDateRange('2027-02-28', '2027-03-03')).toBe('28 Feb – 3 Mar 2027');
  });

  it('keeps both years across a year boundary', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: FAIL — `formatDate` is not exported.

- [ ] **Step 3: Add the formatters to `src/lib/dates.ts`**

```ts
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const FULL = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Human-readable date. Always formatted in UTC so it matches the stored calendar date. */
export function formatDate(d: ISODate): string {
  return FULL.format(parseISODate(d));
}

/** Human-readable range, collapsing whatever the two dates share. */
export function formatDateRange(start: ISODate, end: ISODate): string {
  if (start === end) return formatDate(start);
  const a = parseISODate(start);
  const b = parseISODate(end);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) return `${DAY.format(a)}–${formatDate(end)}`;
  if (sameYear) return `${DAY_MONTH.format(a)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/dates.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Write `src/components/EventRow.astro`**

```astro
---
import type { LoadedEvent } from '../lib/types';
import { hasOpenDeadline, isStale } from '../lib/events';
import { compareISO, formatDate, formatDateRange, type ISODate } from '../lib/dates';

interface Props {
  event: LoadedEvent;
  today: ISODate;
}

const { event, today } = Astro.props;

const search = [event.title, event.organizer ?? '', event.location?.city ?? '']
  .join(' ')
  .toLowerCase();

const open = hasOpenDeadline(event, today);
const next = (event.deadlines ?? [])
  .filter((d) => compareISO(d.date, today) >= 0)
  .sort((a, b) => compareISO(a.date, b.date))[0];

const place =
  event.format === 'online'
    ? 'Online'
    : [event.location?.city, event.location?.country].filter(Boolean).join(', ');
---

<li
  class="event"
  data-search={search}
  data-topics={event.topics.join(' ')}
  data-region={event.region}
  data-country={event.location?.country ?? ''}
  data-format={event.format}
  data-type={event.type}
  data-start={event.start_date}
  data-end={event.end_date}
  data-deadline={open ? 'open' : ''}
>
  <p class="mono event__when">
    <time datetime={event.start_date}>{formatDateRange(event.start_date, event.end_date)}</time>
  </p>

  <div class="event__body">
    <h3 class="event__title">
      <a href={`/events/${event.id}/`}>{event.title}</a>
      {
        event.status && event.status !== 'scheduled' && (
          <span class="pill pill--status">{event.status}</span>
        )
      }
    </h3>

    <p class="mono muted event__meta">
      {event.type} · {event.format} · {place}
      {event.organizer && <> · {event.organizer}</>}
    </p>

    <p class="event__desc">{event.description}</p>

    <p class="event__tags">
      {event.topics.map((t) => <span class="pill pill--topic">{t}</span>)}
      {
        next && (
          <span class="pill pill--deadline">
            {next.type.replace('_', ' ')}{' '}
            <time datetime={next.date} data-countdown>
              {formatDate(next.date)}
            </time>
          </span>
        )
      }
    </p>

    {
      event.status && event.status !== 'scheduled' && event.status_note && (
        <p class="warn">{event.status_note}</p>
      )
    }
    {
      isStale(event, today) && (
        <p class="warn">
          Dates last verified on {formatDate(event.last_verified)}. Check the official page.
        </p>
      )
    }
  </div>
</li>
```

- [ ] **Step 6: Add the row styles to `src/styles/global.css`**

```css
/* Event rows: a dense grid, not cards. */
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.event {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr);
  gap: var(--space-m);
  padding-block: var(--space-m);
  border-block-start: 1px solid var(--rule);
}

.event:last-child {
  border-block-end: 1px solid var(--rule);
}

.event__when {
  margin: 0;
  padding-block-start: 0.25rem;
  color: var(--warm);
}

.event__title {
  font-size: var(--step-1);
  margin-block-end: var(--space-xs);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-s);
  align-items: baseline;
}

.event__title a {
  color: var(--fg);
  text-decoration: none;
}

.event__title a:hover {
  color: var(--cool);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.event__meta {
  margin-block-end: var(--space-xs);
}

.event__desc {
  margin-block-end: var(--space-xs);
}

.event__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin: 0;
}

@media (max-width: 40rem) {
  .event {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
  }
}

/* Filter rail */
.filters {
  position: sticky;
  top: var(--space-m);
  display: grid;
  gap: var(--space-m);
  font-size: var(--step--1);
}

.filters fieldset {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: var(--space-s);
  margin: 0;
}

.filters legend {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--fg-muted);
  padding-inline: var(--space-xs);
}

.filters label {
  display: block;
  margin-block-end: var(--space-xs);
}

.filters input[type='text'],
.filters input[type='date'],
.filters select {
  width: 100%;
  font: inherit;
  color: var(--fg);
  background: var(--bg-raise);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  padding: 0.35em 0.5em;
}

.filters__topics {
  display: grid;
  gap: 0.2rem;
  max-height: 16rem;
  overflow-y: auto;
}

.filters__topics label {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
  margin: 0;
}

.filters__clear {
  font: inherit;
  font-family: var(--font-mono);
  color: var(--warm);
  background: none;
  border: 1px solid var(--warm);
  border-radius: var(--radius);
  padding: 0.4em 0.8em;
  cursor: pointer;
}

@media (max-width: 52rem) {
  .filters {
    position: static;
  }
}

.result-count {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  color: var(--fg-muted);
  margin-block-end: var(--space-s);
}
```

- [ ] **Step 7: Write `src/pages/index.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import EventRow from '../components/EventRow.astro';
import { loadEvents, upcomingEvents } from '../lib/events';
import { todayUTC } from '../lib/dates';
import { EVENT_FORMATS, EVENT_TYPES, type Topic } from '../lib/types';
import { REGIONS } from '../lib/regions';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const today = todayUTC();
const events = upcomingEvents(loadEvents());
const topics = (parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[]) ?? [];

// Only offer options the data actually contains.
const usedTopics = new Set(events.flatMap((e) => e.topics));
const countries = [...new Set(events.map((e) => e.location?.country).filter(Boolean))].sort();
const regions = REGIONS.filter((r) => events.some((e) => e.region === r));
const hasOnline = events.some((e) => e.region === 'Online');
---

<Base
  title="Upcoming events"
  description="Upcoming conferences, workshops and schools in computational and theoretical chemistry, with deadlines, filters and calendar export."
  path="/"
>
  <h1>Upcoming events</h1>
  <p class="muted">
    Conferences, workshops and schools in computational and theoretical chemistry. Listings follow
    the <a href="/policy/">curation policy</a>.
  </p>

  <noscript>
    <p class="warn">
      Filtering needs JavaScript. Every upcoming event is listed below in date order, and the
      <a href="/deadlines/">deadlines page</a> lists every open deadline.
    </p>
  </noscript>

  <div class="rail">
    <form class="filters" id="filters" hidden>
      <div>
        <label for="f-q">Search title, organiser or city</label>
        <input type="text" id="f-q" name="q" autocomplete="off" />
      </div>

      <fieldset>
        <legend>Topics</legend>
        <div class="filters__topics">
          {
            topics
              .filter((t) => usedTopics.has(t.slug))
              .map((t) => (
                <label>
                  <input type="checkbox" name="topic" value={t.slug} />
                  {t.label}
                </label>
              ))
          }
        </div>
      </fieldset>

      <div>
        <label for="f-region">Region</label>
        <select id="f-region" name="region">
          <option value="">Any</option>
          {regions.map((r) => <option value={r}>{r}</option>)}
          {hasOnline && <option value="Online">Online</option>}
        </select>
      </div>

      <div>
        <label for="f-country">Country</label>
        <select id="f-country" name="country">
          <option value="">Any</option>
          {countries.map((c) => <option value={c}>{c}</option>)}
        </select>
      </div>

      <div>
        <label for="f-format">Format</label>
        <select id="f-format" name="format">
          <option value="">Any</option>
          {EVENT_FORMATS.map((f) => <option value={f}>{f}</option>)}
        </select>
      </div>

      <div>
        <label for="f-type">Type</label>
        <select id="f-type" name="type">
          <option value="">Any</option>
          {EVENT_TYPES.map((t) => <option value={t}>{t}</option>)}
        </select>
      </div>

      <fieldset>
        <legend>Dates</legend>
        <label for="f-from">From</label>
        <input type="date" id="f-from" name="from" />
        <label for="f-to">To</label>
        <input type="date" id="f-to" name="to" />
      </fieldset>

      <label>
        <input type="checkbox" name="deadline" value="open" /> Has an open deadline
      </label>

      <button type="button" class="filters__clear" id="clear-filters">Clear filters</button>
    </form>

    <div>
      <p class="result-count" id="result-count" role="status" aria-live="polite">
        {events.length} upcoming {events.length === 1 ? 'event' : 'events'}
      </p>
      <ul class="event-list reveal" id="event-list">
        {events.map((event) => <EventRow event={event} today={today} />)}
      </ul>
      {events.length === 0 && <p class="muted">No upcoming events are listed yet.</p>}
    </div>
  </div>
</Base>

<script>
  import '../scripts/filters.ts';
</script>
```

- [ ] **Step 8: Write the island, `src/scripts/filters.ts`**

```ts
import {
  EMPTY_FILTER,
  isEmptyFilter,
  matchesFilter,
  parseFilterState,
  rowFromDataset,
  serialiseFilterState,
  type FilterRow,
  type FilterState,
} from '../lib/filter';

const form = document.querySelector<HTMLFormElement>('#filters');
const list = document.querySelector<HTMLUListElement>('#event-list');
const countEl = document.querySelector<HTMLElement>('#result-count');
const clearButton = document.querySelector<HTMLButtonElement>('#clear-filters');

if (form && list && countEl) {
  // Filtering is a JavaScript feature, so the controls only appear once it runs.
  form.hidden = false;

  const rows: { el: HTMLElement; row: FilterRow }[] = [
    ...list.querySelectorAll<HTMLElement>('li.event'),
  ].map((el) => ({ el, row: rowFromDataset({ ...el.dataset }) }));

  const field = <T extends HTMLElement>(name: string): T | null =>
    form.querySelector<T>(`[name="${name}"]`);

  function readForm(): FilterState {
    const topics = [...form!.querySelectorAll<HTMLInputElement>('input[name="topic"]:checked')].map(
      (i) => i.value,
    );
    return {
      q: field<HTMLInputElement>('q')?.value.trim() ?? '',
      topics,
      region: field<HTMLSelectElement>('region')?.value ?? '',
      country: field<HTMLSelectElement>('country')?.value ?? '',
      format: field<HTMLSelectElement>('format')?.value ?? '',
      type: field<HTMLSelectElement>('type')?.value ?? '',
      from: field<HTMLInputElement>('from')?.value ?? '',
      to: field<HTMLInputElement>('to')?.value ?? '',
      deadline: field<HTMLInputElement>('deadline')?.checked ?? false,
    };
  }

  function writeForm(state: FilterState): void {
    const q = field<HTMLInputElement>('q');
    if (q) q.value = state.q;
    for (const box of form!.querySelectorAll<HTMLInputElement>('input[name="topic"]')) {
      box.checked = state.topics.includes(box.value);
    }
    for (const name of ['region', 'country', 'format', 'type', 'from', 'to'] as const) {
      const el = field<HTMLSelectElement | HTMLInputElement>(name);
      if (el) el.value = state[name];
    }
    const deadline = field<HTMLInputElement>('deadline');
    if (deadline) deadline.checked = state.deadline;
  }

  function apply(state: FilterState, pushUrl: boolean): void {
    let shown = 0;
    for (const { el, row } of rows) {
      const match = matchesFilter(row, state);
      el.hidden = !match;
      if (match) shown += 1;
    }

    countEl!.textContent = isEmptyFilter(state)
      ? `${shown} upcoming ${shown === 1 ? 'event' : 'events'}`
      : `${shown} of ${rows.length} ${rows.length === 1 ? 'event' : 'events'} match`;

    if (pushUrl) {
      const params = serialiseFilterState(state).toString();
      history.pushState(null, '', params ? `?${params}` : location.pathname);
    }
  }

  function syncFromUrl(): void {
    const state = parseFilterState(new URLSearchParams(location.search));
    writeForm(state);
    apply(state, false);
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', () => apply(readForm(), true));
  form.addEventListener('change', () => apply(readForm(), true));
  clearButton?.addEventListener('click', () => {
    writeForm(EMPTY_FILTER);
    apply(EMPTY_FILTER, true);
  });
  window.addEventListener('popstate', syncFromUrl);

  syncFromUrl();
}
```

- [ ] **Step 9: Verify the build, the JS budget and manual behaviour**

```bash
npm run build
find dist/_astro -name '*.js' -exec sh -c 'gzip -c "$1" | wc -c' _ {} \; | paste -sd+ | bc
```

Expected: the total is well under 30720 bytes. Record the number for the PR.

```bash
npm run preview
```

Check by hand: ticking a topic reduces the list and changes the URL; reloading that URL restores the same filtered view; Back restores the previous one; "Clear filters" empties the URL; the count text updates.

Then disable JavaScript in the browser and reload `/`. Expected: every event listed, no filter form, the `<noscript>` note visible.

- [ ] **Step 10: Commit**

```bash
git add src/lib/dates.ts tests/lib/dates.test.ts src/components/EventRow.astro \
  src/pages/index.astro src/scripts/filters.ts src/styles/global.css
git commit -m "feat: add the home page with URL-driven client-side filtering

Events render server-side as rows carrying filter data attributes; the island
only toggles hidden, so the list is complete without JavaScript. Filter state
round-trips through the query string and Back works.

The filter form is hidden until the island unhides it, so a visitor without
JavaScript never sees controls that would silently do nothing."
```

---

## Task 12: Event detail pages

**Files:**
- Create: `src/pages/events/[id].astro`, `src/components/DeadlineList.astro`

**Interfaces:**
- Consumes: `loadEvents`, `eventById`, `isStale` from `src/lib/events.ts`; `formatDate`, `formatDateRange`, `todayUTC` from `src/lib/dates.ts`; `site` from `site.config.ts`.
- Produces: one static page per event at `/events/<id>/`.

- [ ] **Step 1: Write `src/components/DeadlineList.astro`**

`AoE` is the schema default when `timezone` is absent, so it is expanded here rather than left blank.

```astro
---
import type { Deadline } from '../lib/types';
import { formatDate } from '../lib/dates';

interface Props {
  deadlines: Deadline[];
}

const { deadlines } = Astro.props;

const LABELS: Record<Deadline['type'], string> = {
  abstract: 'Abstract',
  registration: 'Registration',
  early_bird: 'Early bird',
  travel_grant: 'Travel grant',
  poster: 'Poster',
  application: 'Application',
};

const zoneLabel = (tz: string | undefined): string =>
  !tz || tz === 'AoE' ? 'AoE (Anywhere on Earth)' : tz;
---

<table class="deadlines">
  <caption class="muted">Deadlines as published by the organiser.</caption>
  <thead>
    <tr>
      <th scope="col">Deadline</th>
      <th scope="col">Date</th>
      <th scope="col">Timezone</th>
      <th scope="col">Note</th>
    </tr>
  </thead>
  <tbody>
    {
      deadlines.map((d) => (
        <tr>
          <th scope="row">{LABELS[d.type]}</th>
          <td class="mono">
            <time datetime={d.date} data-countdown>
              {formatDate(d.date)}
            </time>
          </td>
          <td class="mono">{zoneLabel(d.timezone)}</td>
          <td>{d.note ?? ''}</td>
        </tr>
      ))
    }
  </tbody>
</table>
```

- [ ] **Step 2: Write `src/pages/events/[id].astro`**

```astro
---
import Base from '../../layouts/Base.astro';
import DeadlineList from '../../components/DeadlineList.astro';
import { eventById, isStale, loadEvents } from '../../lib/events';
import { formatDate, formatDateRange, todayUTC } from '../../lib/dates';
import { site } from '../../../site.config';
import type { LoadedEvent } from '../../lib/types';

export function getStaticPaths() {
  return loadEvents().map((event) => ({ params: { id: event.id }, props: { event } }));
}

interface Props {
  event: LoadedEvent;
}

const { event } = Astro.props;
const today = todayUTC();
const path = `/events/${event.id}/`;
const pageUrl = new URL(path, site.url).href;

const reportUrl = (() => {
  const u = new URL(site.reportForm.url);
  u.searchParams.set(site.reportForm.eventIdParam, event.id);
  u.searchParams.set(site.reportForm.eventUrlParam, pageUrl);
  return u.href;
})();

const correctionUrl = (() => {
  const u = new URL(`${site.repoUrl}/issues/new`);
  u.searchParams.set('template', 'correction.yml');
  u.searchParams.set('title', `Correction: ${event.id}`);
  u.searchParams.set('labels', 'correction');
  return u.href;
})();

const place =
  event.format === 'online'
    ? 'Online'
    : [event.location?.venue, event.location?.city, event.location?.country]
        .filter(Boolean)
        .join(', ');

// schema.org Event. `endDate` is the last day, which is the schema.org
// convention — unlike iCalendar's exclusive DTEND.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Event',
  name: event.title,
  startDate: event.start_date,
  endDate: event.end_date,
  eventAttendanceMode:
    event.format === 'online'
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : event.format === 'hybrid'
        ? 'https://schema.org/MixedEventAttendanceMode'
        : 'https://schema.org/OfflineEventAttendanceMode',
  eventStatus:
    event.status === 'cancelled'
      ? 'https://schema.org/EventCancelled'
      : event.status === 'postponed'
        ? 'https://schema.org/EventPostponed'
        : 'https://schema.org/EventScheduled',
  description: event.description,
  url: event.url,
  ...(event.organizer ? { organizer: { '@type': 'Organization', name: event.organizer } } : {}),
  ...(event.location
    ? {
        location: {
          '@type': 'Place',
          name: event.location.venue ?? event.location.city,
          address: {
            '@type': 'PostalAddress',
            addressLocality: event.location.city,
            addressCountry: event.location.country,
          },
        },
      }
    : { location: { '@type': 'VirtualLocation', url: event.url } }),
};
---

<Base title={event.title} description={event.description} path={path}>
  <article class="reveal">
    <h1>{event.title}</h1>

    {
      event.status && event.status !== 'scheduled' && (
        <p>
          <span class="pill pill--status">{event.status}</span>
          {event.status_note && <span class="muted"> {event.status_note}</span>}
        </p>
      )
    }

    <dl class="detail">
      <dt>Dates</dt>
      <dd class="mono">
        <time datetime={event.start_date}>{formatDateRange(event.start_date, event.end_date)}</time>
      </dd>

      <dt>Type</dt>
      <dd class="mono">{event.type}</dd>

      <dt>Format</dt>
      <dd class="mono">{event.format}</dd>

      <dt>Location</dt>
      <dd>{place}</dd>

      {event.organizer && <dt>Organiser</dt>}
      {event.organizer && <dd>{event.organizer}</dd>}

      <dt>Official page</dt>
      <dd><a href={event.url} rel="noopener">{event.url}</a></dd>

      {event.source_url && <dt>Dates verified on</dt>}
      {
        event.source_url && (
          <dd>
            <a href={event.source_url} rel="noopener">
              {event.source_url}
            </a>
          </dd>
        )
      }

      <dt>Topics</dt>
      <dd class="event__tags">
        {event.topics.map((t) => <a class="pill pill--topic" href={`/?topics=${t}`}>{t}</a>)}
      </dd>
    </dl>

    <p>{event.description}</p>

    {
      event.deadlines && event.deadlines.length > 0 && (
        <>
          <h2>Deadlines</h2>
          <DeadlineList deadlines={event.deadlines} />
        </>
      )
    }

    <hr class="rule" />

    <p class="mono muted">
      Last verified on {formatDate(event.last_verified)}.
      {isStale(event, today) && ' Check the official page before relying on these dates.'}
    </p>

    <p>
      <a href={correctionUrl} rel="noopener">Suggest a correction</a> ·
      <a href={reportUrl} rel="noopener">Report this event</a>
    </p>
  </article>

  <script type="application/ld+json" set:html={JSON.stringify(jsonLd)} is:inline />
  <script>
    import '../../scripts/countdown.ts';
  </script>
</Base>
```

- [ ] **Step 3: Add the detail styles to `src/styles/global.css`**

```css
.detail {
  display: grid;
  grid-template-columns: minmax(0, 10rem) minmax(0, 1fr);
  gap: var(--space-xs) var(--space-m);
  margin-block: var(--space-m);
  padding-block: var(--space-m);
  border-block: 1px solid var(--rule);
}

.detail dt {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
}

.detail dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.deadlines {
  border-collapse: collapse;
  width: 100%;
  margin-block: var(--space-m);
}

.deadlines caption {
  text-align: start;
  font-size: var(--step--1);
  padding-block-end: var(--space-xs);
}

.deadlines th,
.deadlines td {
  text-align: start;
  padding: var(--space-xs) var(--space-s);
  border-block-end: 1px solid var(--rule);
  vertical-align: baseline;
}

.deadlines thead th {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
  border-block-end-color: var(--rule-strong);
}

@media (max-width: 40rem) {
  .detail {
    grid-template-columns: minmax(0, 1fr);
  }
  .detail dd {
    margin-block-end: var(--space-xs);
  }
}
```

- [ ] **Step 4: Create a placeholder countdown module so the build resolves**

`src/scripts/countdown.ts` is written properly in Task 18; create it now as a no-op so this page compiles.

```ts
// Implemented in Task 18. Kept as a module so pages can import it now.
export {};
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run typecheck`
Expected: both pass, and `dist/events/<id>/index.html` exists for every event.

```bash
node -e "const h=require('fs').readFileSync(process.argv[1],'utf8');const m=/<script type=\"application\/ld\+json\">(.+?)<\/script>/s.exec(h);JSON.parse(m[1]);console.log('JSON-LD parses')" dist/events/full-online-2027/index.html
```

Expected: `JSON-LD parses`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/events src/components/DeadlineList.astro src/scripts/countdown.ts src/styles/global.css
git commit -m "feat: add event detail pages with deadlines and JSON-LD

Renders full details, a deadline table naming each timezone with AoE expanded,
prefilled report and correction links built from site.config.ts, the
last-verified date with a staleness note, and schema.org Event JSON-LD."
```

---
## Task 13: Deadlines and archive pages

**Files:**
- Create: `src/pages/deadlines.astro`, `src/pages/archive.astro`

**Interfaces:**
- Consumes: `loadEvents`, `pastEvents`, `upcomingDeadlines` from `src/lib/events.ts`; `formatDate`, `formatDateRange`, `todayUTC` from `src/lib/dates.ts`.
- Produces: `/deadlines/` and `/archive/`.

`/deadlines/` carries the topic filter only, so it reuses the island's data attributes but offers just the topic fieldset.

- [ ] **Step 1: Write `src/pages/deadlines.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import { loadEvents, upcomingDeadlines } from '../lib/events';
import { formatDate, formatDateRange, todayUTC } from '../lib/dates';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { Topic } from '../lib/types';

const today = todayUTC();
const rows = upcomingDeadlines(loadEvents(), today);
const topics = (parse(readFileSync('data/topics.yaml', 'utf8')) as Topic[]) ?? [];
const used = new Set(rows.flatMap((r) => r.event.topics));

const LABELS: Record<string, string> = {
  abstract: 'Abstract',
  registration: 'Registration',
  early_bird: 'Early bird',
  travel_grant: 'Travel grant',
  poster: 'Poster',
  application: 'Application',
};
---

<Base
  title="Upcoming deadlines"
  description="Abstract, registration and application deadlines across every listed computational chemistry event, soonest first."
  path="/deadlines/"
>
  <h1>Upcoming deadlines</h1>
  <p class="muted">
    Soonest first. Deadlines are shown as published by the organiser; <span class="mono">AoE</span>
    means Anywhere on Earth.
  </p>

  <noscript>
    <p class="warn">Filtering needs JavaScript. Every open deadline is listed below in date order.</p>
  </noscript>

  <div class="rail">
    <form class="filters" id="filters" hidden>
      <fieldset>
        <legend>Topics</legend>
        <div class="filters__topics">
          {
            topics
              .filter((t) => used.has(t.slug))
              .map((t) => (
                <label>
                  <input type="checkbox" name="topic" value={t.slug} />
                  {t.label}
                </label>
              ))
          }
        </div>
      </fieldset>
      <button type="button" class="filters__clear" id="clear-filters">Clear filters</button>
    </form>

    <div>
      <p class="result-count" id="result-count" role="status" aria-live="polite">
        {rows.length} open {rows.length === 1 ? 'deadline' : 'deadlines'}
      </p>
      <ul class="event-list reveal" id="event-list">
        {
          rows.map(({ event, deadline }) => (
            <li
              class="event"
              data-search={event.title.toLowerCase()}
              data-topics={event.topics.join(' ')}
              data-region={event.region}
              data-country={event.location?.country ?? ''}
              data-format={event.format}
              data-type={event.type}
              data-start={deadline.date}
              data-end={deadline.date}
              data-deadline="open"
            >
              <p class="mono event__when">
                <time datetime={deadline.date} data-countdown>
                  {formatDate(deadline.date)}
                </time>
              </p>
              <div class="event__body">
                <h3 class="event__title">
                  <a href={`/events/${event.id}/`}>{event.title}</a>
                  <span class="pill pill--deadline">{LABELS[deadline.type] ?? deadline.type}</span>
                </h3>
                <p class="mono muted event__meta">
                  Event {formatDateRange(event.start_date, event.end_date)} ·{' '}
                  {deadline.timezone ?? 'AoE'}
                  {deadline.note && <> · {deadline.note}</>}
                </p>
              </div>
            </li>
          ))
        }
      </ul>
      {rows.length === 0 && <p class="muted">No open deadlines are listed.</p>}
    </div>
  </div>
</Base>

<script>
  import '../scripts/filters.ts';
  import '../scripts/countdown.ts';
</script>
```

- [ ] **Step 2: Write `src/pages/archive.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import { loadEvents, pastEvents } from '../lib/events';
import { formatDateRange } from '../lib/dates';

const past = pastEvents(loadEvents());

const byYear = new Map<string, typeof past>();
for (const event of past) {
  const year = event.start_date.slice(0, 4);
  byYear.set(year, [...(byYear.get(year) ?? []), event]);
}
const years = [...byYear.keys()].sort().reverse();
---

<Base
  title="Archive"
  description="Past computational chemistry conferences, workshops and schools, grouped by year."
  path="/archive/"
>
  <h1>Archive</h1>
  <p class="muted">Events that have already finished, newest first.</p>

  {years.length === 0 && <p class="muted">Nothing has been archived yet.</p>}

  {
    years.map((year) => (
      <section>
        <h2 class="mono">{year}</h2>
        <ul class="event-list">
          {byYear.get(year)!.map((event) => (
            <li class="event">
              <p class="mono event__when">
                <time datetime={event.start_date}>
                  {formatDateRange(event.start_date, event.end_date)}
                </time>
              </p>
              <div class="event__body">
                <h3 class="event__title">
                  <a href={`/events/${event.id}/`}>{event.title}</a>
                  {event.status === 'cancelled' && <span class="pill pill--status">cancelled</span>}
                </h3>
                <p class="mono muted event__meta">
                  {event.type} · {event.format} ·{' '}
                  {event.format === 'online' ? 'Online' : event.location?.city}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    ))
  }
</Base>
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build && npm run typecheck && npm run lint`
Expected: all pass; `dist/deadlines/index.html` and `dist/archive/index.html` exist.

```bash
git add src/pages/deadlines.astro src/pages/archive.astro
git commit -m "feat: add deadlines and archive pages

Deadlines lists every open deadline across all events soonest first, with the
topic filter. Archive groups finished events by year, newest first."
```

---

## Task 14: Static pages, sitemap and robots

**Files:**
- Create: `src/pages/about.astro`, `src/pages/submit.astro`, `src/pages/policy.astro`, `src/pages/404.astro`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`

**Interfaces:**
- Consumes: `site` from `site.config.ts`; `loadEvents` from `src/lib/events.ts`; the markdown at `docs/curation-policy.md`.
- Produces: the remaining routes, plus `/sitemap.xml` and `/robots.txt`.

- [ ] **Step 1: Write `src/pages/policy.astro`**

The policy has exactly one source of truth, `docs/curation-policy.md`, so the page renders that file rather than restating it.

```astro
---
import Base from '../layouts/Base.astro';
import { Content as Policy } from '../../docs/curation-policy.md';
---

<Base
  title="Curation policy"
  description="What we list, what we decline, how listings are verified, and how to report or dispute one."
  path="/policy/"
>
  <div class="prose">
    <Policy />
  </div>
</Base>
```

Verify the import resolves: `npm run build`. If Astro declines to process markdown outside `src/`, create `src/pages/_policy.md` as a one-line re-export is not possible for markdown — instead add `docs` to the Astro `srcDir` include by importing through a relative path from a file inside `src/`, which is what the line above already does. Should it still fail, copy the file into `src/content/curation-policy.md` **and** add a CI step asserting the two files are identical, so they cannot drift.

- [ ] **Step 2: Write `src/pages/submit.astro`**

The three routes come from `CONTRIBUTING.md`.

```astro
---
import Base from '../layouts/Base.astro';
import { site } from '../../site.config';
---

<Base
  title="Add an event"
  description="Three ways to add a computational chemistry event: a pull request, a GitHub issue, or a form that needs no account."
  path="/submit/"
>
  <div class="prose">
    <h1>Add an event</h1>
    <p>
      Anyone can add or correct a listing. Pick whichever of the three routes suits you. Every
      submission is checked against the <a href="/policy/">curation policy</a> before it appears.
    </p>

    <h2>1. Pull request</h2>
    <p>
      Fastest if you are comfortable with Git. Add one YAML file to <code>data/events/</code>,
      run <code>npm run validate</code>, and open a pull request. The
      <a href={`${site.repoUrl}/blob/main/CONTRIBUTING.md`} rel="noopener">contributing guide</a>
      has the exact steps and the
      <a href={`${site.repoUrl}/blob/main/docs/data-schema.md`} rel="noopener">data schema</a>
      documents every field.
    </p>

    <h2>2. GitHub issue</h2>
    <p>
      No coding needed. Open an
      <a href={`${site.repoUrl}/issues/new?labels=event-submission`} rel="noopener">
        event submission issue
      </a>
      with a link to the official page, and a maintainer will turn it into a pull request.
    </p>

    <h2>3. Submission form</h2>
    <p>
      No GitHub account needed. Use the
      <a href={site.submissionFormUrl} rel="noopener">submission form</a>. A maintainer reviews it
      and adds the event.
    </p>

    <h2>What we need</h2>
    <p>
      A link to the organiser's official page, the dates, the location or online format, and an
      identifiable organising body. We write descriptions in our own words rather than copying the
      organiser's text.
    </p>
  </div>
</Base>
```

- [ ] **Step 3: Write `src/pages/about.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import { site } from '../../site.config';
---

<Base
  title="About"
  description="A community-maintained calendar of computational and theoretical chemistry events, built as a static site with no tracking."
  path="/about/"
>
  <div class="prose">
    <h1>About</h1>
    <p>
      {site.name} is a community-maintained calendar of conferences, workshops and schools in
      computational and theoretical chemistry: electronic structure, molecular simulation, machine
      learning for chemistry and materials, computational materials science and computational drug
      design.
    </p>

    <h2>How it works</h2>
    <p>
      Every event is a YAML file in a public Git repository, validated automatically. The site is
      built to static files, so there is no server and no database. Anyone can
      <a href="/submit/">add or correct an event</a>.
    </p>

    <h2>Privacy</h2>
    <p>
      No cookies, no analytics, no trackers, no third-party scripts and no external fonts. Nothing
      about your visit is recorded by this site.
    </p>

    <h2>Feeds and exports</h2>
    <ul>
      <li><a href="/events.ics">Events calendar</a> — subscribe in any calendar app.</li>
      <li><a href="/deadlines.ics">Deadlines calendar</a> — every open deadline.</li>
      <li><a href="/feed.xml">Atom feed</a> — newly added events.</li>
      <li><a href="/events.json">JSON</a> — the full dataset.</li>
    </ul>

    <h2>Corrections</h2>
    <p>
      Every event page has a correction link and a report link. See the
      <a href="/policy/">curation policy</a> for how reports are handled, or email
      <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
    </p>

    <h2>Source</h2>
    <p><a href={site.repoUrl} rel="noopener">{site.repoUrl}</a></p>
  </div>
</Base>
```

- [ ] **Step 4: Write `src/pages/404.astro`**

```astro
---
import Base from '../layouts/Base.astro';
---

<Base title="Page not found" description="That page does not exist." path="/404/">
  <div class="prose">
    <h1>Page not found</h1>
    <p>
      That page does not exist. Try the <a href="/">list of upcoming events</a>, the
      <a href="/deadlines/">deadlines</a>, or the <a href="/archive/">archive</a>.
    </p>
  </div>
</Base>
```

- [ ] **Step 5: Add `.prose` styles to `src/styles/global.css`**

```css
.prose {
  max-width: var(--measure);
}

.prose h2 {
  margin-block-start: var(--space-l);
}

.prose h3 {
  margin-block-start: var(--space-m);
}

.prose ul,
.prose ol {
  max-width: var(--measure);
  padding-inline-start: 1.2em;
}

.prose li {
  margin-block-end: var(--space-xs);
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-raise);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 0.1em 0.35em;
}

.prose table {
  border-collapse: collapse;
  width: 100%;
}

.prose th,
.prose td {
  text-align: start;
  padding: var(--space-xs) var(--space-s);
  border-block-end: 1px solid var(--rule);
}

.prose blockquote {
  margin-inline: 0;
  padding-inline-start: var(--space-m);
  border-inline-start: 2px solid var(--cool);
  color: var(--fg-muted);
}
```

- [ ] **Step 6: Write `src/pages/sitemap.xml.ts` and `src/pages/robots.txt.ts`**

```ts
import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import { site } from '../../site.config';

const STATIC_PATHS = ['/', '/deadlines/', '/archive/', '/about/', '/submit/', '/policy/'];

export const GET: APIRoute = () => {
  const paths = [...STATIC_PATHS, ...loadEvents().map((e) => `/events/${e.id}/`)];
  const urls = paths
    .map((p) => `  <url><loc>${new URL(p, site.url).href}</loc></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
```

```ts
import type { APIRoute } from 'astro';
import { site } from '../../site.config';

export const GET: APIRoute = () => {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', site.url).href}\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
```

- [ ] **Step 7: Verify and commit**

Run: `npm run build`

```bash
test -f dist/about/index.html && test -f dist/submit/index.html \
  && test -f dist/policy/index.html && test -f dist/404.html \
  && test -f dist/sitemap.xml && test -f dist/robots.txt && echo "all routes built"
```

Expected: `all routes built`. Open `dist/policy/index.html` and confirm the curation policy rendered in full.

```bash
git add src/pages/ src/styles/global.css
git commit -m "feat: add about, submit, policy and 404 pages plus sitemap and robots

The policy page renders docs/curation-policy.md directly so there is one
source of truth. Sitemap and robots are generated from the route list and
site.config.ts."
```

- [ ] **Step 8: Merge phase 2**

```bash
git checkout main
git merge --no-ff feat/phase-2-pages -m "feat: phase 2 — pages

Design system, base layout, home page with URL-driven filtering, event detail
pages, deadlines, archive, static pages, sitemap and robots."
```

---

## Task 15: iCalendar serialisation

Phase 3. Branch: `feat/phase-3-feeds`.

The fiddly parts of RFC 5545 live here, isolated and tested, so the endpoints in Task 16 stay trivial.

**Files:**
- Create: `src/lib/ical.ts`, `tests/lib/ical.test.ts`

**Interfaces:**
- Consumes: `addDays`, `ISODate` from `src/lib/dates.ts`.
- Produces:
  - `escapeText(value: string): string`
  - `foldLine(line: string): string`
  - `icalDate(d: ISODate): string` — `YYYYMMDD`
  - `interface VEventInput { uid: string; summary: string; description?: string; start: ISODate; end: ISODate; url?: string; location?: string; cancelled?: boolean }`
  - `buildCalendar(name: string, events: VEventInput[], stamp: Date): string`

`end` is the **last day of the event**; `buildCalendar` adds one day to produce the exclusive `DTEND` RFC 5545 requires.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ical.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { buildCalendar, escapeText, foldLine, icalDate } from '../../src/lib/ical';

const stamp = new Date('2026-09-20T06:00:00Z');

const sample = [
  {
    uid: 'a-2027@compchem.example',
    summary: 'Workshop, with a comma; and a semicolon',
    description: 'Line one\nline two',
    start: '2027-03-08',
    end: '2027-03-10',
    url: 'https://example.org/a/',
    location: 'Exampleville, NL',
  },
  {
    uid: 'b-2027@compchem.example',
    summary: 'Cancelled Meeting',
    start: '2027-05-01',
    end: '2027-05-01',
    cancelled: true,
  },
];

describe('escapeText', () => {
  it('escapes backslashes first', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('escapes commas, semicolons and newlines', () => {
    expect(escapeText('a,b;c\nd')).toBe('a\\,b\;c\\nd');
  });

  it('collapses CRLF to a single escaped newline', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true);
    expect(parts.join('').replace(/\r\n /g, '')).toBe(`SUMMARY:${'x'.repeat(200)}`);
  });

  it('never splits a multi-byte character', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}`);
    for (const p of folded.split('\r\n')) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });
});

describe('icalDate', () => {
  it('strips the dashes', () => {
    expect(icalDate('2027-03-08')).toBe('20270308');
  });
});

describe('buildCalendar', () => {
  const ics = buildCalendar('Test Calendar', sample, stamp);

  it('uses CRLF line endings throughout', () => {
    expect(ics.includes('\n')).toBe(true);
    expect(ics.split('\r\n').length).toBeGreaterThan(10);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('sets X-WR-CALNAME', () => {
    expect(ics).toContain('X-WR-CALNAME:Test Calendar');
  });

  it('parses with a real iCalendar parser', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    expect(comp.name).toBe('vcalendar');
    expect(comp.getAllSubcomponents('vevent')).toHaveLength(2);
  });

  it('makes DTEND exclusive: the day after the last day', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = new ICAL.Event(comp.getAllSubcomponents('vevent')[0]);
    expect(first.startDate.toString()).toBe('2027-03-08');
    // Event runs 8-10 March, so DTEND is 11 March.
    expect(first.endDate.toString()).toBe('2027-03-11');
  });

  it('makes a single-day event span exactly one day', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const second = new ICAL.Event(comp.getAllSubcomponents('vevent')[1]);
    expect(second.startDate.toString()).toBe('2027-05-01');
    expect(second.endDate.toString()).toBe('2027-05-02');
  });

  it('uses all-day DATE values, not date-times', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20270308');
    expect(ics).toContain('DTEND;VALUE=DATE:20270311');
  });

  it('keeps UIDs stable and unique', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const uids = comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v).uid);
    expect(uids).toEqual(['a-2027@compchem.example', 'b-2027@compchem.example']);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('round-trips escaped text', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = new ICAL.Event(comp.getAllSubcomponents('vevent')[0]);
    expect(first.summary).toBe('Workshop, with a comma; and a semicolon');
    expect(first.description).toBe('Line one\nline two');
  });

  it('marks cancelled events', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const second = comp.getAllSubcomponents('vevent')[1];
    expect(second.getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('omits STATUS for events that are not cancelled', () => {
    const comp = new ICAL.Component(ICAL.parse(ics));
    const first = comp.getAllSubcomponents('vevent')[0];
    expect(first.getFirstPropertyValue('status')).toBe(null);
  });

  it('produces a valid empty calendar', () => {
    const empty = buildCalendar('Empty', [], stamp);
    const comp = new ICAL.Component(ICAL.parse(empty));
    expect(comp.getAllSubcomponents('vevent')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/ical.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/ical`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ical.ts`:

```ts
import { addDays, type ISODate } from './dates';

export interface VEventInput {
  uid: string;
  summary: string;
  description?: string;
  /** First day of the event. */
  start: ISODate;
  /** Last day of the event. `buildCalendar` converts this to an exclusive DTEND. */
  end: ISODate;
  url?: string;
  location?: string;
  cancelled?: boolean;
}

/** RFC 5545 section 3.3.11. Backslash must be escaped first. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/[\r\n]/g, '\\n')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,');
}

const encoder = new TextEncoder();

/**
 * RFC 5545 section 3.1: lines are folded at 75 octets, continuations starting
 * with a single space. Folds between code points so multi-byte characters
 * survive, and counts octets rather than characters.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let isFirst = true;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // Continuation lines carry a leading space, so they have one fewer octet.
    const limit = isFirst ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      isFirst = false;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);

  return parts[0] + parts.slice(1).map((p) => `\r\n ${p}`).join('');
}

function stampOf(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export function icalDate(d: ISODate): string {
  return d.replace(/-/g, '');
}

export function buildCalendar(name: string, events: VEventInput[], stamp: Date): string {
  const dtstamp = stampOf(stamp);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CompChem Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icalDate(e.start)}`,
      // DTEND is exclusive: the day after the last day of the event.
      `DTEND;VALUE=DATE:${icalDate(addDays(e.end, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/ical.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/phase-3-feeds
git add src/lib/ical.ts tests/lib/ical.test.ts
git commit -m "feat: add RFC 5545 iCalendar serialisation

CRLF endings, 75-octet folding that never splits a multi-byte character,
escaped text, all-day DATE values and an exclusive DTEND. Tests parse the
output back with ical.js."
```

---

## Task 16: Calendar endpoints

**Files:**
- Create: `src/pages/events.ics.ts`, `src/pages/deadlines.ics.ts`, `tests/endpoints/ics.test.ts`

**Interfaces:**
- Consumes: `buildCalendar`, `VEventInput` from `src/lib/ical.ts`; `loadEvents`, `upcomingEvents`, `upcomingDeadlines` from `src/lib/events.ts`; `siteDomain`, `site` from `site.config.ts`.
- Produces:
  - `eventsCalendar(events: LoadedEvent[], stamp: Date): string`
  - `deadlinesCalendar(events: LoadedEvent[], today: ISODate, stamp: Date): string`
  - Both exported from their route modules so tests can call them without running a build.

- [ ] **Step 1: Write `src/pages/events.ics.ts`**

```ts
import type { APIRoute } from 'astro';
import { buildCalendar, type VEventInput } from '../lib/ical';
import { loadEvents, upcomingEvents } from '../lib/events';
import type { LoadedEvent } from '../lib/types';
import { site, siteDomain } from '../../site.config';

export function eventsCalendar(events: LoadedEvent[], stamp: Date): string {
  const items: VEventInput[] = events.map((e) => ({
    uid: `${e.id}@${siteDomain}`,
    summary: e.title,
    description: [e.description, e.url].join('\n\n'),
    start: e.start_date,
    end: e.end_date,
    url: e.url,
    location:
      e.format === 'online'
        ? 'Online'
        : [e.location?.venue, e.location?.city, e.location?.country].filter(Boolean).join(', '),
    cancelled: e.status === 'cancelled',
  }));
  return buildCalendar(`${site.name} — events`, items, stamp);
}

export const GET: APIRoute = () =>
  new Response(eventsCalendar(upcomingEvents(loadEvents()), new Date()), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
```

- [ ] **Step 2: Write `src/pages/deadlines.ics.ts`**

```ts
import type { APIRoute } from 'astro';
import { buildCalendar, type VEventInput } from '../lib/ical';
import { loadEvents, upcomingDeadlines } from '../lib/events';
import { todayUTC, type ISODate } from '../lib/dates';
import type { LoadedEvent } from '../lib/types';
import { site, siteDomain } from '../../site.config';

const LABELS: Record<string, string> = {
  abstract: 'Abstract deadline',
  registration: 'Registration deadline',
  early_bird: 'Early bird deadline',
  travel_grant: 'Travel grant deadline',
  poster: 'Poster deadline',
  application: 'Application deadline',
};

export function deadlinesCalendar(events: LoadedEvent[], today: ISODate, stamp: Date): string {
  const items: VEventInput[] = upcomingDeadlines(events, today).map(({ event, deadline }) => {
    const zone = deadline.timezone ?? 'AoE';
    return {
      uid: `${event.id}-${deadline.type}@${siteDomain}`,
      summary: `[${LABELS[deadline.type] ?? deadline.type}] ${event.title}`,
      description: [
        `Timezone: ${zone === 'AoE' ? 'AoE (Anywhere on Earth)' : zone}`,
        deadline.note ?? '',
        event.url,
      ]
        .filter(Boolean)
        .join('\n'),
      // A deadline is a single all-day entry on its own date.
      start: deadline.date,
      end: deadline.date,
      url: event.url,
    };
  });
  return buildCalendar(`${site.name} — deadlines`, items, stamp);
}

export const GET: APIRoute = () =>
  new Response(deadlinesCalendar(loadEvents(), todayUTC(), new Date()), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
```

- [ ] **Step 3: Write the round-trip test**

Create `tests/endpoints/ics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { eventsCalendar } from '../../src/pages/events.ics';
import { deadlinesCalendar } from '../../src/pages/deadlines.ics';
import { loadEvents, upcomingDeadlines, upcomingEvents } from '../../src/lib/events';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };
const events = loadEvents(opts);
const stamp = new Date('2026-09-20T06:00:00Z');

function vevents(ics: string) {
  return new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent');
}

describe('events.ics', () => {
  const ics = eventsCalendar(upcomingEvents(events), stamp);

  it('contains one entry per upcoming event', () => {
    expect(vevents(ics)).toHaveLength(upcomingEvents(events).length);
  });

  it('gives every entry a unique UID on the site domain', () => {
    const uids = vevents(ics).map((v) => String(new ICAL.Event(v).uid));
    expect(new Set(uids).size).toBe(uids.length);
    for (const uid of uids) expect(uid).toContain('@placeholder.example');
  });

  it('makes DTEND exclusive', () => {
    for (const v of vevents(ics)) {
      const e = new ICAL.Event(v);
      // The stored end_date is the last day, so DTEND must be strictly later.
      expect(e.endDate.toJSDate().getTime()).toBeGreaterThan(e.startDate.toJSDate().getTime());
    }
  });

  it('marks the cancelled fixture as cancelled', () => {
    const cancelled = vevents(ics).filter((v) => v.getFirstPropertyValue('status') === 'CANCELLED');
    expect(cancelled).toHaveLength(1);
  });
});

describe('deadlines.ics', () => {
  const ics = deadlinesCalendar(events, '2026-09-20', stamp);

  it('contains one entry per open deadline', () => {
    expect(vevents(ics)).toHaveLength(upcomingDeadlines(events, '2026-09-20').length);
  });

  it('titles entries with the deadline kind', () => {
    const summaries = vevents(ics).map((v) => String(new ICAL.Event(v).summary));
    expect(summaries.some((s) => s.startsWith('[Abstract deadline] '))).toBe(true);
  });

  it('uses the id-and-type UID form', () => {
    for (const v of vevents(ics)) {
      expect(String(new ICAL.Event(v).uid)).toMatch(
        /^[a-z0-9-]+-(abstract|registration|early_bird|travel_grant|poster|application)@/,
      );
    }
  });

  it('spans exactly one day per deadline', () => {
    for (const v of vevents(ics)) {
      const e = new ICAL.Event(v);
      const days =
        (e.endDate.toJSDate().getTime() - e.startDate.toJSDate().getTime()) / 86_400_000;
      expect(days).toBe(1);
    }
  });

  it('names the timezone in the description', () => {
    const descriptions = vevents(ics).map((v) => String(new ICAL.Event(v).description));
    expect(descriptions.some((d) => d.includes('AoE (Anywhere on Earth)'))).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/endpoints/ics.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify the built artefacts and commit**

```bash
npm run build
head -c 400 dist/events.ics
file dist/events.ics
```

Expected: begins `BEGIN:VCALENDAR`, with CRLF line endings.

```bash
git add src/pages/events.ics.ts src/pages/deadlines.ics.ts tests/endpoints/
git commit -m "feat: add events.ics and deadlines.ics endpoints

Stable UIDs on the site domain, exclusive DTEND, STATUS:CANCELLED where it
applies, and AoE named in deadline descriptions. Tests parse both outputs back
with ical.js and assert counts, UIDs and dates."
```

---

## Task 17: Atom feed and JSON export

**Files:**
- Create: `src/pages/feed.xml.ts`, `src/pages/events.json.ts`, `tests/endpoints/exports.test.ts`
- Modify: `docs/data-schema.md` (document `schema_version`)

**Interfaces:**
- Consumes: `loadEvents` from `src/lib/events.ts`; `site` from `site.config.ts`.
- Produces:
  - `atomFeed(events: LoadedEvent[], generatedAt: Date): string`
  - `eventsExport(events: LoadedEvent[], generatedAt: Date): object`

Spec D5: `schema_version` ships from day one. Field names in the export are a public API — additions are fine, renames and removals need a version bump.

- [ ] **Step 1: Write `src/pages/feed.xml.ts`**

```ts
import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import { compareISO } from '../lib/dates';
import type { LoadedEvent } from '../lib/types';
import { site } from '../../site.config';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function atomFeed(events: LoadedEvent[], generatedAt: Date): string {
  const newest = [...events].sort((a, b) => compareISO(b.added, a.added)).slice(0, 50);
  const selfUrl = new URL('/feed.xml', site.url).href;
  const entries = newest
    .map((e) => {
      const url = new URL(`/events/${e.id}/`, site.url).href;
      return [
        '  <entry>',
        `    <title>${xml(e.title)}</title>`,
        `    <link href="${xml(url)}"/>`,
        `    <id>${xml(url)}</id>`,
        `    <updated>${e.added}T00:00:00Z</updated>`,
        `    <summary>${xml(e.description)}</summary>`,
        '  </entry>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(site.name)} — newly added events</title>`,
    `  <link href="${xml(selfUrl)}" rel="self"/>`,
    `  <link href="${xml(site.url)}"/>`,
    `  <id>${xml(new URL('/', site.url).href)}</id>`,
    `  <updated>${generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}</updated>`,
    entries,
    '</feed>',
    '',
  ].join('\n');
}

export const GET: APIRoute = () =>
  new Response(atomFeed(loadEvents(), new Date()), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
```

- [ ] **Step 2: Write `src/pages/events.json.ts`**

```ts
import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import type { LoadedEvent } from '../lib/types';

export function eventsExport(events: LoadedEvent[], generatedAt: Date): object {
  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    count: events.length,
    events: events.map(({ fixture, ...rest }) => {
      void fixture;
      return rest;
    }),
  };
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify(eventsExport(loadEvents(), new Date()), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
```

- [ ] **Step 3: Write the test**

Create `tests/endpoints/exports.test.ts`. Note the import specifiers: these modules are named
`feed.xml.ts` and `events.json.ts`, so `from '../../src/pages/feed.xml'` relies on extension
resolution. If Vitest fails to resolve it, write the explicit extension
(`'../../src/pages/feed.xml.ts'`) — `allowImportingTsExtensions` is enabled in `tsconfig.json`
for exactly this case.

```ts
import { describe, expect, it } from 'vitest';
import { atomFeed } from '../../src/pages/feed.xml';
import { eventsExport } from '../../src/pages/events.json';
import { loadEvents } from '../../src/lib/events';

const opts = { eventsDir: 'tests/fixtures/valid', today: '2026-09-20', includeFixtures: true };
const events = loadEvents(opts);
const at = new Date('2026-09-20T06:00:00Z');

describe('atomFeed', () => {
  const feed = atomFeed(events, at);

  it('is well-formed XML', () => {
    // No unescaped raw ampersands outside entities.
    expect(/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(feed)).toBe(false);
    expect(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(feed.trimEnd().endsWith('</feed>')).toBe(true);
  });

  it('has one entry per event', () => {
    expect(feed.match(/<entry>/g) ?? []).toHaveLength(events.length);
  });

  it('carries a self link and a feed id', () => {
    expect(feed).toContain('rel="self"');
    expect(feed).toContain('<id>https://placeholder.example/</id>');
  });

  it('timestamps entries from the added date', () => {
    expect(feed).toContain('<updated>2026-09-20T00:00:00Z</updated>');
  });

  it('escapes special characters in titles', () => {
    const escaped = atomFeed(
      [{ ...events[0]!, title: 'A & B <tag>' }],
      at,
    );
    expect(escaped).toContain('A &amp; B &lt;tag&gt;');
  });
});

describe('eventsExport', () => {
  const data = eventsExport(events, at) as {
    schema_version: number;
    generated_at: string;
    count: number;
    events: Record<string, unknown>[];
  };

  it('declares schema_version 1', () => {
    expect(data.schema_version).toBe(1);
  });

  it('reports a generated_at timestamp and a matching count', () => {
    expect(data.generated_at).toBe('2026-09-20T06:00:00Z');
    expect(data.count).toBe(data.events.length);
  });

  it('includes the derived region and status fields', () => {
    for (const e of data.events) {
      expect(e.region).toBeDefined();
      expect(e.status_derived).toBeDefined();
    }
  });

  it('does not leak the internal fixture flag', () => {
    for (const e of data.events) expect('fixture' in e).toBe(false);
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(JSON.stringify(data))).not.toThrow();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/endpoints/exports.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Document `schema_version` in `docs/data-schema.md`**

Replace the `/events.json` example so it matches what the code emits:

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-20T06:00:00Z",
  "count": 0,
  "events": [ /* every non-fixture event, same field names as above, plus "region" and "status_derived" */ ]
}
```

And add below it:

> `schema_version` is `1`. Field names in the export are a public API. Additions are fine; renames and removals need a `schema_version` bump and a note in the README.

- [ ] **Step 6: Verify and commit**

```bash
npm run build
node -e "JSON.parse(require('fs').readFileSync('dist/events.json','utf8'));console.log('events.json parses')"
node -e "const s=require('fs').readFileSync('dist/feed.xml','utf8');if(!s.includes('<feed'))throw new Error('bad feed');console.log('feed.xml looks well-formed')"
```

```bash
git add src/pages/feed.xml.ts src/pages/events.json.ts tests/endpoints/exports.test.ts docs/data-schema.md
git commit -m "feat: add the Atom feed and JSON export

feed.xml lists newly added events by the added field, newest first.
events.json ships schema_version 1 from day one per spec D5, with region and
status_derived included and the internal fixture flag stripped."
```

---

## Task 18: Countdown island, documentation and release

**Files:**
- Replace: `src/scripts/countdown.ts` (the no-op from Task 12)
- Modify: `README.md`, `docs/decisions.md`

**Interfaces:**
- Consumes: `time[data-countdown]` elements with an ISO `datetime` attribute.
- Produces: no exports; a side-effecting module.

Spec §6: the server renders the plain date, and the client adds the relative phrase so it cannot go stale between builds.

- [ ] **Step 1: Write `src/scripts/countdown.ts`**

```ts
// Deadline countdowns are computed in the browser so a static build cannot
// serve a stale "closes in 12 days". The server renders the plain date; this
// appends the relative phrase beside it, leaving the <time> element's own text
// (and therefore its machine-readable meaning) untouched.

const MS_PER_DAY = 86_400_000;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function todayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-countdown]')) {
  const iso = el.getAttribute('datetime');
  if (!iso || el.dataset.countdownDone === 'true') continue;

  const target = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(target)) continue;

  const days = Math.round((target - todayUtcMs()) / MS_PER_DAY);
  const phrase = days < 0 ? 'closed' : days === 0 ? 'closes today' : `closes ${rtf.format(days, 'day')}`;

  const note = document.createElement('span');
  note.className = 'countdown muted';
  note.textContent = ` · ${phrase}`;
  el.insertAdjacentElement('afterend', note);
  el.dataset.countdownDone = 'true';
}
```

- [ ] **Step 2: Add the countdown style**

```css
.countdown {
  font-family: var(--font-mono);
  font-size: var(--step--1);
  white-space: nowrap;
}
```

- [ ] **Step 3: Load it on the home page**

In `src/pages/index.astro`, extend the script block:

```astro
<script>
  import '../scripts/filters.ts';
  import '../scripts/countdown.ts';
</script>
```

- [ ] **Step 4: Verify behaviour by hand**

```bash
npm run build && npm run preview
```

Check: each deadline shows its plain date plus a relative phrase; with JavaScript disabled only the plain date appears and nothing is broken.

- [ ] **Step 5: Update `README.md` so its commands are true from a clean checkout**

Replace the "Local development" section with the actual commands, and delete the "_The implementing agent must keep this section accurate as commands change._" line now that it is accurate:

```markdown
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
```

Also update the status line, since v1 is built:

```markdown
> **Status:** v1 (phases 0-3). Phase 4 and the discovery agent are tracked in [`TASK.md`](TASK.md).
```

- [ ] **Step 6: Close out `docs/decisions.md`**

Append any decision taken during implementation that is not already recorded, and confirm every deviation from `TASK.md` has an entry. At minimum there should be entries for: v1 scope, the system font stack, seed data volume, filter semantics, `schema_version`, `regionOf`, ratings deferral, the site name, the YAML library choice, and the split of validation logic into `src/lib/validation.ts` with `scripts/validate.ts` re-exporting it.

- [ ] **Step 7: Run every gate one final time**

```bash
npm ci && npm run lint && npm run typecheck && npm run validate && npm test && npm run build
```

Expected: all pass from a clean install.

- [ ] **Step 8: Measure the JavaScript budget and attempt Lighthouse**

```bash
find dist/_astro -name '*.js' -exec sh -c 'gzip -c "$1" | wc -c' _ {} \; | paste -sd+ | bc
```

Expected: under 30720. Record the number.

```bash
npx lighthouse http://localhost:4321/ --only-categories=performance,accessibility,best-practices,seo --preset=desktop --chrome-flags="--headless" --output=json --output-path=/tmp/lh-home.json
```

Target: 95 or higher on all four, for `/` and one event page. **If headless Chrome is unavailable in this environment, do not fabricate scores.** Say so explicitly in the final report, note that the structural targets were met (no framework, no external requests, semantic HTML, canonical and OpenGraph tags present), and list it as a check the maintainer should run after deploying.

- [ ] **Step 9: Merge phase 3 and report**

```bash
git add -A
git commit -m "feat: add client-side deadline countdowns and finish the docs

Countdowns are computed in the browser so they cannot go stale between builds,
appended beside the server-rendered date rather than replacing it.

Updates README with the real commands and closes out the decision log."
git checkout main
git merge --no-ff feat/phase-3-feeds -m "feat: phase 3 — feeds and exports

iCalendar serialisation, events.ics, deadlines.ics, feed.xml, events.json and
client-side deadline countdowns."
```

Then write the final report covering, per `TASK.md` §9: what was built per phase; the home page JS size and Lighthouse scores (or why they could not be measured); every assumption and deviation with its reason; anything not done, including the human-only steps still pending from spec §12; and suggested next steps — which are phase 4 and then the discovery agent.

---

## Deferred to a follow-up plan

Phase 4 from `TASK.md`, per spec D1: duplicate-detection and link-check PR checks, `.github/workflows/links.yml`, `.github/workflows/rebuild.yml` with `CF_DEPLOY_HOOK`, the two GitHub issue forms, and the Playwright smoke test. Phase 5, the discovery agent, is specified in `docs/discovery-agent.md` and is a separate task; v1 satisfies its two obligations already — `validateEvent` is importable as a library, and `data/` contains nothing an automated pull request would trip over.
