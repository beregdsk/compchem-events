#!/usr/bin/env node
// Monthly, on the discovery host: snapshot OpenAlex statistics per site
// topic into data/topic-stats.json and propose it as a PR. All or nothing.
// Needs GITHUB_TOKEN and GITHUB_REPO; OPENALEX_API_KEY is optional.
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { todayUTC } from '../../src/lib/dates';
import {
  syncFailureIssue,
  type FailureIssue,
  type GitHubOptions,
} from '../../src/lib/discovery/github-client';
import { Proposer } from '../../src/lib/discovery/propose';
import {
  loadTopicStats,
  TOPIC_STATS_FILE,
  validateTopicStats,
  type TopicStats,
} from '../../src/lib/topic-stats';
import type { OpenAlexOptions } from '../../src/lib/topics/openalex';
import { formatForRepo } from '../../src/lib/topics/propose-map';
import { buildSnapshot, buildSnapshotPrBody } from '../../src/lib/topics/snapshot';
import type { Topic } from '../../src/lib/types';
import { formatProblems, loadTopics } from '../../src/lib/validation';

export const FAILURE_SOURCE = 'topic-stats';

export interface SnapshotDeps {
  github: GitHubOptions;
  openalex: OpenAlexOptions;
  today: string;
  /** Default to data/topics.yaml. */
  topics?: readonly Topic[];
  /** Defaults to the committed snapshot; pass undefined for none. */
  previous?: TopicStats;
  log?: (m: string) => void;
}

export interface SnapshotResult {
  outcome: 'opened' | 'updated' | 'reviewed' | 'failed';
  pr?: number;
  error?: string;
}

/** Its own tracking issue: the nightly discovery run's sync must neither overwrite nor close it. */
export const FAILURE_ISSUE: FailureIssue = {
  title: 'Topic statistics snapshot failed',
  label: 'topic-stats-failures',
};

/** The committed snapshot for the PR body's comparison; an unreadable one counts as none. */
function readPrevious(log: (m: string) => void): TopicStats | undefined {
  try {
    return loadTopicStats();
  } catch (err) {
    log(
      `previous snapshot unreadable, comparing against none: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

export async function runSnapshot(deps: SnapshotDeps): Promise<SnapshotResult> {
  const log = deps.log ?? (() => {});
  const syncIssue = (errors: Array<{ source: string; message: string }>) =>
    syncFailureIssue(errors, deps.github, FAILURE_ISSUE).catch((e: unknown) =>
      log(`failed to sync the failure issue: ${e instanceof Error ? e.message : String(e)}`),
    );
  try {
    const topics = deps.topics ?? loadTopics();
    const previous = 'previous' in deps ? deps.previous : readPrevious(log);
    const next = await buildSnapshot(topics, deps.today, deps.openalex);
    const problems = validateTopicStats(next, topics);
    if (problems.errors.length > 0) {
      throw new Error(`snapshot failed validation:\n${formatProblems(problems)}`);
    }
    const month = deps.today.slice(0, 7);
    const proposal = await new Proposer(deps.github).proposeFile({
      branch: `data/topic-stats-${month}`,
      path: TOPIC_STATS_FILE,
      content: await formatForRepo(JSON.stringify(next, null, 2), TOPIC_STATS_FILE),
      title: `Topic statistics: ${month} snapshot`,
      message: `Update topic statistics (${month})`,
      body: buildSnapshotPrBody(next, previous, new Map(topics.map((t) => [t.slug, t.label]))),
      labels: ['data'],
    });
    await syncIssue([]);
    if (proposal.outcome === 'reviewed') {
      log(`the ${month} snapshot PR was already closed or merged; nothing written`);
      return { outcome: 'reviewed' };
    }
    // proposeFile refreshes an open PR here; 'proposed' only comes with refresh: false.
    const outcome = proposal.outcome === 'opened' ? 'opened' : 'updated';
    log(`${outcome} PR #${proposal.pr}`);
    return { outcome, pr: proposal.pr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR ${FAILURE_SOURCE}: ${message}`);
    await syncIssue([{ source: FAILURE_SOURCE, message }]);
    return { outcome: 'failed', error: message };
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPO are required');
    process.exitCode = 1;
    return;
  }
  const result = await runSnapshot({
    github: { token, repo },
    openalex: { mailto: site.contactEmail, apiKey: process.env.OPENALEX_API_KEY || undefined },
    today: todayUTC(),
    log: (m) => console.error(m),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome === 'failed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
