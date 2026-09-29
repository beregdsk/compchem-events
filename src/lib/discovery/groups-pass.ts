// The scheduled run's groups pass: resolve this run's group leads into
// drafts, propose them as pull requests, and keep the negative cache honest.
// Spec: docs/superpowers/specs/2026-09-29-groups-registry-design.md.
import { parse } from 'yaml';
import type { ISODate } from '../dates';
import type { RawGroup } from '../types';
import type { ExtractOptions } from './extract-client';
import type { FetchOptions } from './fetch';
import { listFilesOnBranch, listOpenDiscoveryPrs, type GitHubOptions } from './github-client';
import { buildRegistryIndex } from './group-match';
import { forgetLookups, resolveGroupLeads } from './groups';
import { proposeGroups } from './orchestrator';
import type { GroupLead } from './parsers/group-listing';
import { loadState, saveState } from './state';

const BACKFILL_BRANCH = 'discovery/groups-backfill';
const GROUP_BRANCH_PREFIX = 'discovery/group/';

/** The groups in open group PRs (one per `discovery/group/*` branch, many on the backfill branch). */
export async function openGroupDrafts(github: GitHubOptions): Promise<RawGroup[]> {
  const drafts: RawGroup[] = [];
  for (const pr of await listOpenDiscoveryPrs(github)) {
    if (!pr.headRef.startsWith(GROUP_BRANCH_PREFIX) && pr.headRef !== BACKFILL_BRANCH) continue;
    for (const file of await listFilesOnBranch(pr.headRef, 'data/groups', github)) {
      const data: unknown = parse(file.content);
      if (typeof data === 'object' && data !== null && typeof (data as RawGroup).id === 'string') {
        drafts.push(data as RawGroup);
      }
    }
  }
  return drafts;
}

export interface GroupsPassOptions {
  leads: readonly GroupLead[];
  existingGroups: readonly RawGroup[];
  statePath: string;
  fetch: Omit<FetchOptions, 'state'>;
  extract: ExtractOptions;
  github: GitHubOptions;
  maxSearches: number;
  maxPages: number;
  maxPrs: number;
  maxTokens: number;
  tokensUsedSoFar: number;
  blockedHosts: ReadonlySet<string>;
  today: ISODate;
  log?: (message: string) => void;
}

export interface GroupsPassResult {
  prsOpened: number;
  skipped: Array<{ id: string; reason: string }>;
  searches: number;
  tokensUsed: number;
  errors: Array<{ source: string; message: string }>;
}

/** Never rejects: any failure is logged and returned in `errors`. */
export async function runGroupsPass(options: GroupsPassOptions): Promise<GroupsPassResult> {
  const log = options.log ?? (() => {});
  const result: GroupsPassResult = {
    prsOpened: 0,
    skipped: [],
    searches: 0,
    tokensUsed: 0,
    errors: [],
  };
  try {
    const state = loadState(options.statePath);
    const known = [...options.existingGroups, ...(await openGroupDrafts(options.github))];
    const resolved = await resolveGroupLeads({
      leads: options.leads,
      index: buildRegistryIndex(known),
      takenIds: new Set(known.map((g) => g.id)),
      state,
      fetch: options.fetch,
      extract: options.extract,
      maxSearches: options.maxSearches,
      maxPages: options.maxPages,
      maxTokens: options.maxTokens,
      tokensUsedSoFar: options.tokensUsedSoFar,
      today: options.today,
      log,
    });
    result.searches = resolved.searches;
    result.tokensUsed = resolved.tokensUsed;
    result.errors.push(...resolved.errors);
    const proposed = await proposeGroups({
      candidates: resolved.candidates,
      known,
      blockedHosts: options.blockedHosts,
      github: options.github,
      maxPrs: options.maxPrs,
      log,
    });
    result.prsOpened = proposed.prsOpened;
    result.skipped = proposed.skipped;
    result.errors.push(...proposed.errors);
    // A name whose PR was never opened (MAX_PRS, or a GitHub error) must be
    // tried again next run, not cached as drafted for 90 days.
    const failed = new Set(proposed.errors.map((e) => e.source));
    forgetLookups(state, [
      ...proposed.deferredKeys,
      ...resolved.candidates.filter((c) => failed.has(c.draft.id)).map((c) => c.lookupKey),
    ]);
    saveState(options.statePath, state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`groups pass failed: ${message}`);
    result.errors.push({ source: 'groups', message });
  }
  return result;
}
