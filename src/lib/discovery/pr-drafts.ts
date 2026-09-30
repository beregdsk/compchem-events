// The event and position drafts sitting in discovery PRs: open ones, still
// awaiting review, and ones closed without merging, which a reviewer
// rejected. Both count as known when checking a new candidate for
// duplicates, so a second source finding the same event on a later night
// neither opens a second PR nor brings a rejected one back.
import { parse } from 'yaml';
import type { RawEvent, RawPosition } from '../types';
import type { KnownDraft } from './duplicates';
import {
  listOpenDiscoveryPrs,
  listPrYamlFiles,
  listRejectedDiscoveryPrs,
  type GitHubOptions,
} from './github-client';
import type { DiscoveryState } from './state';

const EVENTS_DIR = 'data/events/';
const POSITIONS_DIR = 'data/positions/';
/** Group PRs are deduplicated by the groups pass itself (openGroupDrafts). */
const GROUP_BRANCHES = /^discovery\/(group\/|groups-backfill$)/;

export interface PrDrafts {
  events: KnownDraft<RawEvent>[];
  positions: KnownDraft<RawPosition>[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isEventDraft(v: unknown): v is RawEvent {
  return (
    isRecord(v) &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.start_date === 'string'
  );
}

function isPositionDraft(v: unknown): v is RawPosition {
  return (
    isRecord(v) &&
    typeof v.title === 'string' &&
    typeof v.url === 'string' &&
    typeof v.institution === 'string'
  );
}

function parseYaml(content: string): unknown {
  try {
    return parse(content);
  } catch {
    return undefined;
  }
}

function addFiles(
  out: PrDrafts,
  files: ReadonlyArray<{ path: string; data: unknown }>,
  where: string,
  branch?: string,
): void {
  for (const { path, data } of files) {
    if (path.startsWith(EVENTS_DIR) && isEventDraft(data)) {
      out.events.push({ entry: data, where, branch });
    } else if (path.startsWith(POSITIONS_DIR) && isPositionDraft(data)) {
      out.positions.push({ entry: data, where, branch });
    }
  }
}

/**
 * Open PRs are read every run (they can still change); a rejected PR is read
 * once and cached in `state.rejectedPrs`, so the cost stays at one listing
 * call per 100 closed PRs.
 */
export async function discoveryPrDrafts(
  github: GitHubOptions,
  state: DiscoveryState,
): Promise<PrDrafts> {
  const out: PrDrafts = { events: [], positions: [] };
  const dirs = [EVENTS_DIR, POSITIONS_DIR];

  for (const pr of await listOpenDiscoveryPrs(github)) {
    if (GROUP_BRANCHES.test(pr.headRef)) continue;
    const files = await listPrYamlFiles(pr.number, pr.headSha, dirs, github);
    addFiles(
      out,
      files.map((f) => ({ path: f.path, data: parseYaml(f.content) })),
      `#${pr.number} (open)`,
      pr.headRef,
    );
  }

  for (const pr of await listRejectedDiscoveryPrs(github)) {
    if (GROUP_BRANCHES.test(pr.headRef)) continue;
    let cached = state.rejectedPrs[String(pr.number)];
    if (!cached) {
      const files = await listPrYamlFiles(pr.number, pr.headSha, dirs, github);
      cached = { files: files.map((f) => ({ path: f.path, data: parseYaml(f.content) })) };
      state.rejectedPrs[String(pr.number)] = cached;
    }
    // No branch: a rejected PR blocks even the candidate with its own id,
    // whose branch may have been deleted and would otherwise be reopened.
    addFiles(out, cached.files, `#${pr.number} (closed without merging)`);
  }
  return out;
}
