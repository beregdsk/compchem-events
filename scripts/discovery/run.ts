#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { loadEvents } from '../../src/lib/events';
import { loadGroups } from '../../src/lib/groups';
import { loadPositions } from '../../src/lib/positions';
import { loadValidationContext } from '../../src/lib/validation';
import { ADD_THRESHOLD, DEFAULT_JEV_MODEL } from '../../src/lib/discovery/classify-candidate';
import { DEFAULT_EXTRACT_BASE_URL } from '../../src/lib/discovery/extract-client';
import { DEFAULT_JEV_BASE_URL } from '../../src/lib/discovery/jev-client';
import { fetchWithBrowser } from '../../src/lib/discovery/browser-fetch';
import type { MailboxCredentials } from '../../src/lib/discovery/mailbox-client';
import { leadsFromEvents, leadsFromPositions } from '../../src/lib/discovery/group-match';
import { runGroupsPass } from '../../src/lib/discovery/groups-pass';
import { todayUTC } from '../../src/lib/dates';
import { runDiscoveryRun, type OrchestratorOptions } from '../../src/lib/discovery/orchestrator';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';
import { autoApproveHighConfidencePrs } from '../../src/lib/discovery/auto-approve';

export interface ResolvedConfig {
  statePath: string;
  maxPages: number;
  maxPagesPerSource: number;
  maxTokens: number;
  maxPrs: number;
  maxSearches: number;
  userAgent: string;
  extract: { apiKey: string; baseUrl: string; model: string };
  classify: { apiKey: string; baseUrl: string; model: string };
  github: { token: string; repo: string };
  /** Undefined until IMAP_HOST/IMAP_USER/IMAP_PASSWORD are all set — `mailbox` sources stay inert until then. */
  mailbox?: MailboxCredentials;
}

export type ConfigResult = { ok: true; config: ResolvedConfig } | { ok: false; error: string };

export function buildConfig(env: Record<string, string | undefined>): ConfigResult {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return { ok: false, error: 'LLM_API_KEY is required' };
  const extractModel = env.LLM_MODEL_EXTRACT;
  if (!extractModel) return { ok: false, error: 'LLM_MODEL_EXTRACT is required' };
  const statePath = env.STATE_PATH;
  if (!statePath) return { ok: false, error: 'STATE_PATH is required' };
  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) return { ok: false, error: 'GITHUB_TOKEN is required' };
  const githubRepo = env.GITHUB_REPO;
  if (!githubRepo || !/^[^/\s]+\/[^/\s]+$/.test(githubRepo)) {
    return {
      ok: false,
      error: `GITHUB_REPO must be in the form "owner/repo", got "${githubRepo}"`,
    };
  }

  const maxPages = env.MAX_PAGES ? Number(env.MAX_PAGES) : 200;
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    return { ok: false, error: `MAX_PAGES must be a positive number, got "${env.MAX_PAGES}"` };
  }
  const maxPagesPerSource = env.MAX_PAGES_PER_SOURCE ? Number(env.MAX_PAGES_PER_SOURCE) : 40;
  if (!Number.isFinite(maxPagesPerSource) || maxPagesPerSource <= 0) {
    return {
      ok: false,
      error: `MAX_PAGES_PER_SOURCE must be a positive number, got "${env.MAX_PAGES_PER_SOURCE}"`,
    };
  }
  const maxTokens = env.MAX_TOKENS ? Number(env.MAX_TOKENS) : 500_000;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { ok: false, error: `MAX_TOKENS must be a positive number, got "${env.MAX_TOKENS}"` };
  }
  const maxPrs = env.MAX_PRS ? Number(env.MAX_PRS) : 20;
  if (!Number.isFinite(maxPrs) || maxPrs <= 0) {
    return { ok: false, error: `MAX_PRS must be a positive number, got "${env.MAX_PRS}"` };
  }
  const maxSearches = env.MAX_SEARCHES ? Number(env.MAX_SEARCHES) : 20;
  if (!Number.isFinite(maxSearches) || maxSearches <= 0) {
    return {
      ok: false,
      error: `MAX_SEARCHES must be a positive number, got "${env.MAX_SEARCHES}"`,
    };
  }

  // Fully optional: a mailbox account is a human-only operational step (see
  // docs/discovery-agent.md, "Mailing lists"), so none of these three set at
  // all just leaves `mailbox` undefined and every `kind: 'mailbox'` source
  // skips. Only a partial set (a likely typo, e.g. a copy-paste that missed
  // one var) fails fast, matching this function's style everywhere else.
  const imapVars = [env.IMAP_HOST, env.IMAP_USER, env.IMAP_PASSWORD];
  const imapVarsSet = imapVars.filter((v) => v !== undefined).length;
  if (imapVarsSet !== 0 && imapVarsSet !== imapVars.length) {
    return {
      ok: false,
      error: 'IMAP_HOST, IMAP_USER and IMAP_PASSWORD must all be set together, or all omitted',
    };
  }
  let mailbox: MailboxCredentials | undefined;
  if (imapVarsSet > 0) {
    const port = env.IMAP_PORT ? Number(env.IMAP_PORT) : 993;
    if (!Number.isFinite(port) || port <= 0) {
      return { ok: false, error: `IMAP_PORT must be a positive number, got "${env.IMAP_PORT}"` };
    }
    mailbox = {
      host: env.IMAP_HOST!,
      port,
      secure: env.IMAP_SECURE !== 'false',
      user: env.IMAP_USER!,
      password: env.IMAP_PASSWORD!,
    };
  }

  return {
    ok: true,
    config: {
      statePath,
      maxPages,
      maxPagesPerSource,
      maxTokens,
      maxPrs,
      maxSearches,
      userAgent: `${site.name} Discovery Agent (+${site.repoUrl}; ${site.contactEmail})`,
      extract: {
        apiKey,
        baseUrl: env.LLM_BASE_URL ?? DEFAULT_EXTRACT_BASE_URL,
        model: extractModel,
      },
      classify: {
        apiKey,
        baseUrl: env.LLM_BASE_URL_CLASSIFY ?? DEFAULT_JEV_BASE_URL,
        model: env.LLM_MODEL ?? DEFAULT_JEV_MODEL,
      },
      github: { token: githubToken, repo: githubRepo },
      mailbox,
    },
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
  const log = (message: string) => console.error(message);

  const pipelineOptions: PipelineOptions = {
    statePath: cfg.statePath,
    userAgent: cfg.userAgent,
    maxPages: cfg.maxPages,
    maxPagesPerSource: cfg.maxPagesPerSource,
    maxTokens: cfg.maxTokens,
    extract: cfg.extract,
    browserFetchImpl: fetchWithBrowser,
    mailbox: cfg.mailbox,
    log,
  };
  const pipelineResult = await runPipeline(pipelineOptions);
  for (const error of pipelineResult.errors) log(`ERROR ${error.source}: ${error.message}`);

  const ctx = loadValidationContext();
  const orchestratorOptions: OrchestratorOptions = {
    candidates: pipelineResult.candidates,
    existingEvents: loadEvents({ includeFixtures: false }),
    blockedHosts: ctx.blockedHosts,
    classify: cfg.classify,
    github: cfg.github,
    sourceErrors: pipelineResult.errors,
    maxPrs: cfg.maxPrs,
    maxTokens: cfg.maxTokens,
    tokensUsedSoFar: pipelineResult.tokensUsed,
    positions: pipelineResult.positions,
    existingPositions: loadPositions({ includeFixtures: false }),
    log,
  };
  const result = await runDiscoveryRun(orchestratorOptions);
  // The pipeline saved its state before the orchestrator ran; without this,
  // a candidate cut off by MAX_TOKENS/MAX_PRS would never be seen again.
  pipelineResult.requeue(result.deferred);
  if (result.deferred.length > 0) log(`requeued ${result.deferred.length} deferred candidate(s)`);

  const acceptedPositions = pipelineResult.positions
    .filter((p) => p.confidence >= ADD_THRESHOLD)
    .map((p) => p.draft);
  const groups = await runGroupsPass({
    leads: [
      ...leadsFromEvents(result.accepted),
      ...leadsFromPositions(acceptedPositions),
      ...pipelineResult.groupLeads,
    ],
    existingGroups: loadGroups({ includeFixtures: false }),
    statePath: cfg.statePath,
    fetch: { userAgent: cfg.userAgent, browserFetchImpl: fetchWithBrowser },
    extract: { ...cfg.extract, topics: [...ctx.topics] },
    github: cfg.github,
    maxSearches: cfg.maxSearches,
    maxPages: Math.max(0, cfg.maxPages - pipelineResult.pagesFetched),
    maxPrs: Math.max(0, cfg.maxPrs - result.prsOpened - result.prsUpdated),
    maxTokens: cfg.maxTokens,
    tokensUsedSoFar: result.tokensUsed,
    blockedHosts: ctx.blockedHosts,
    today: todayUTC(),
    log,
  });
  for (const error of groups.errors) log(`ERROR groups ${error.source}: ${error.message}`);

  // A separate phase, deliberately run after and independent of the loop
  // above: it revisits *all* currently-open discovery PRs (not just this
  // run's candidates), since CI on a PR opened days ago finishes long after
  // the run that opened it has exited. Never merges — only fast-tracks
  // human review for PRs that already look done. See auto-approve.ts.
  const autoApprove = await autoApproveHighConfidencePrs({ ...cfg.github, log });

  console.log(JSON.stringify({ ...result, groups, autoApprove }, null, 2));
}

// Only run when invoked directly — see scripts/discovery/parse-sources.ts for
// why this compares full resolved file URLs rather than basenames.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
