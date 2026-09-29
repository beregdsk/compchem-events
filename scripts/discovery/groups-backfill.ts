#!/usr/bin/env node
// One-off: propose a registry entry for every organiser, group and group
// listing entry that is already known, as a single batched pull request.
// Spec: docs/superpowers/specs/2026-09-29-groups-registry-design.md, "Backfill".
import { pathToFileURL } from 'node:url';
import { todayUTC, type ISODate } from '../../src/lib/dates';
import { loadEvents } from '../../src/lib/events';
import { loadGroups } from '../../src/lib/groups';
import { loadPositions } from '../../src/lib/positions';
import type { RawEvent, RawGroup, RawPosition } from '../../src/lib/types';
import { loadValidationContext } from '../../src/lib/validation';
import { fetchWithBrowser } from '../../src/lib/discovery/browser-fetch';
import { ADD_THRESHOLD } from '../../src/lib/discovery/classify-candidate';
import { serializeDraft } from '../../src/lib/discovery/draft';
import type { ExtractOptions } from '../../src/lib/discovery/extract-client';
import { politeFetch, type FetchOptions } from '../../src/lib/discovery/fetch';
import type { GitHubOptions } from '../../src/lib/discovery/github-client';
import { groupFilePath } from '../../src/lib/discovery/group-draft';
import {
  buildRegistryIndex,
  leadsFromEvents,
  leadsFromPositions,
} from '../../src/lib/discovery/group-match';
import {
  forgetLookups,
  resolveGroupLeads,
  type GroupCandidate,
} from '../../src/lib/discovery/groups';
import { BACKFILL_BRANCH, openGroupDrafts } from '../../src/lib/discovery/groups-pass';
import { groupSkipReason, inlineCode } from '../../src/lib/discovery/orchestrator';
import { parseGroupListing, type GroupLead } from '../../src/lib/discovery/parsers/group-listing';
import { Proposer, type Proposal } from '../../src/lib/discovery/propose';
import { loadSources, type Source } from '../../src/lib/discovery/sources';
import { loadState, saveState } from '../../src/lib/discovery/state';
import { buildConfig } from './run';

const DEFAULT_MAX_SEARCHES = 200;
const DEFAULT_MAX_PAGES = 500;

export interface BackfillArgs {
  maxSearches?: number;
  maxPages?: number;
  maxTokens?: number;
}

const FLAGS = {
  '--max-searches': 'maxSearches',
  '--max-pages': 'maxPages',
  '--max-tokens': 'maxTokens',
} as const;

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as keyof typeof FLAGS;
    if (!Object.hasOwn(FLAGS, flag)) throw new Error(`unknown argument "${argv[i]}"`);
    const raw = argv[i + 1];
    if (raw === undefined || !/^[1-9]\d*$/.test(raw)) {
      throw new Error(`${flag} needs a positive integer, got "${raw ?? ''}"`);
    }
    args[FLAGS[flag]] = Number(raw);
  }
  return args;
}

/** A table cell: inline code with `|` escaped so a hostile value cannot end the cell. */
const cell = (text: string) => inlineCode(text).replace(/\|/g, '\\|');

/**
 * No `Confidence:` line on purpose: auto-approve reads that line, and a batch
 * of many entries must never be flagged as one high-confidence PR.
 */
export function buildBackfillPrBody(
  accepted: readonly GroupCandidate[],
  skipped: ReadonlyArray<{ name: string; reason: string }>,
): string {
  const rows = accepted.map((c) =>
    [
      cell(c.draft.id),
      cell(c.draft.name),
      cell(c.draft.kind),
      cell(c.draft.website),
      cell(c.confidence.toFixed(2)),
      cell(c.lead.text),
    ].join(' | '),
  );
  return [
    'Registry entries backfilled from existing events, positions and group listings.',
    'Check every entry against its website before merging; delete the files of any that are wrong.',
    '',
    '| id | name | kind | website | confidence | found as |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
    '',
    `Skipped (${skipped.length}):`,
    ...(skipped.length === 0 ? ['- (none)'] : skipped.map((s) => `- ${cell(s.name)}: ${s.reason}`)),
  ].join('\n');
}

export interface BackfillDeps {
  github: GitHubOptions;
  extract: ExtractOptions;
  fetch: Omit<FetchOptions, 'state'>;
  statePath: string;
  today: ISODate;
  maxSearches: number;
  maxPages: number;
  maxTokens: number;
  blockedHosts: ReadonlySet<string>;
  /** Default to the merged data on disk. */
  events?: readonly RawEvent[];
  positions?: readonly RawPosition[];
  groups?: readonly RawGroup[];
  sources?: readonly Source[];
  log?: (message: string) => void;
}

export interface BackfillResult {
  proposal: Proposal;
  accepted: number;
  skipped: number;
}

export async function runBackfill(deps: BackfillDeps): Promise<BackfillResult> {
  const log = deps.log ?? (() => {});
  const state = loadState(deps.statePath);
  // A re-run must re-propose its own earlier drafts, whose 'drafted' lookups
  // would otherwise be served from the negative cache.
  forgetLookups(
    state,
    Object.entries(state.groupLookups)
      .filter(([, l]) => l.outcome === 'drafted')
      .map(([k]) => k),
  );

  const leads: GroupLead[] = [
    ...leadsFromEvents(deps.events ?? loadEvents({ includeFixtures: false })),
    ...leadsFromPositions(deps.positions ?? loadPositions({ includeFixtures: false })),
  ];
  for (const source of deps.sources ?? loadSources()) {
    if (source.kind !== 'group-listing') continue;
    const page = await politeFetch(source.url, { ...deps.fetch, state, force: true });
    if (page.status !== 'fetched') {
      log(`ERROR ${source.name}: listing not fetched (${page.status})`);
      continue;
    }
    leads.push(...parseGroupListing(page.body, page.finalUrl));
  }

  // The backfill branch's own files are left out: they are what a re-run replaces.
  const known: RawGroup[] = [
    ...(deps.groups ?? loadGroups({ includeFixtures: false })),
    ...(await openGroupDrafts(deps.github, { excludeBranch: BACKFILL_BRANCH })),
  ];
  const resolved = await resolveGroupLeads({
    leads,
    index: buildRegistryIndex(known),
    takenIds: new Set(known.map((g) => g.id)),
    state,
    fetch: deps.fetch,
    extract: deps.extract,
    maxSearches: deps.maxSearches,
    maxPages: deps.maxPages,
    maxTokens: deps.maxTokens,
    tokensUsedSoFar: 0,
    today: deps.today,
    log,
  });
  for (const e of resolved.errors) log(`ERROR groups ${e.source}: ${e.message}`);

  const accepted: GroupCandidate[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const c of resolved.candidates) {
    if (c.confidence < ADD_THRESHOLD) {
      skipped.push({ name: c.draft.name, reason: 'low confidence' });
      continue;
    }
    const reason = groupSkipReason(
      c.draft,
      [...known, ...accepted.map((a) => a.draft)],
      deps.blockedHosts,
    );
    if (reason) {
      skipped.push({ name: c.draft.name, reason });
      continue;
    }
    accepted.push(c);
  }

  const proposal = await new Proposer(deps.github).proposeBatch({
    branch: BACKFILL_BRANCH,
    files: accepted.map((c) => ({
      path: groupFilePath(c.draft),
      content: serializeDraft(c.draft),
    })),
    title: 'Groups registry: backfill from existing events, positions and group listings',
    message: 'Add backfilled registry entries',
    body: buildBackfillPrBody(accepted, skipped),
    labels: ['needs-review', 'group'],
  });
  if (proposal.outcome === 'reviewed') {
    log('the backfill PR was already closed or merged; nothing written');
  } else {
    log(`${proposal.outcome} PR #${proposal.pr} with ${accepted.length} entries`);
  }
  saveState(deps.statePath, state);
  return {
    proposal,
    accepted: proposal.outcome === 'reviewed' ? 0 : accepted.length,
    skipped: skipped.length,
  };
}

async function main(): Promise<void> {
  const resolved = buildConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  const cfg = resolved.config;
  const args = parseBackfillArgs(process.argv.slice(2));
  const ctx = loadValidationContext();
  const result = await runBackfill({
    github: cfg.github,
    extract: { ...cfg.extract, topics: [...ctx.topics] },
    fetch: { userAgent: cfg.userAgent, browserFetchImpl: fetchWithBrowser },
    statePath: cfg.statePath,
    today: todayUTC(),
    maxSearches: args.maxSearches ?? DEFAULT_MAX_SEARCHES,
    maxPages: args.maxPages ?? DEFAULT_MAX_PAGES,
    maxTokens: args.maxTokens ?? cfg.maxTokens,
    blockedHosts: ctx.blockedHosts,
    log: (message) => console.error(message),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
