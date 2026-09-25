#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { loadEvents } from '../../src/lib/events';
import { loadValidationContext } from '../../src/lib/validation';
import { DEFAULT_JEV_MODEL } from '../../src/lib/discovery/classify-candidate';
import { DEFAULT_EXTRACT_BASE_URL } from '../../src/lib/discovery/extract-client';
import { DEFAULT_JEV_BASE_URL } from '../../src/lib/discovery/jev-client';
import { runDiscoveryRun, type OrchestratorOptions } from '../../src/lib/discovery/orchestrator';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';

export interface ResolvedConfig {
  statePath: string;
  maxPages: number;
  maxPagesPerSource: number;
  maxTokens: number;
  maxPrs: number;
  userAgent: string;
  extract: { apiKey: string; baseUrl: string; model: string };
  classify: { apiKey: string; baseUrl: string; model: string };
  github: { token: string; repo: string };
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

  return {
    ok: true,
    config: {
      statePath,
      maxPages,
      maxPagesPerSource,
      maxTokens,
      maxPrs,
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
    log,
  };
  const result = await runDiscoveryRun(orchestratorOptions);

  console.log(JSON.stringify(result, null, 2));
}

// Only run when invoked directly — see scripts/discovery/parse-sources.ts for
// why this compares full resolved file URLs rather than basenames.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
