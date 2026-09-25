#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { DEFAULT_EXTRACT_BASE_URL } from '../../src/lib/discovery/extract-client';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';

export interface ResolvedConfig {
  statePath: string;
  maxPages: number;
  maxTokens: number;
  userAgent: string;
  extract: { apiKey: string; baseUrl: string; model: string };
}

export type ConfigResult = { ok: true; config: ResolvedConfig } | { ok: false; error: string };

export function buildConfig(env: Record<string, string | undefined>): ConfigResult {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return { ok: false, error: 'LLM_API_KEY is required' };
  const model = env.LLM_MODEL_EXTRACT;
  if (!model) return { ok: false, error: 'LLM_MODEL_EXTRACT is required' };
  const statePath = env.STATE_PATH;
  if (!statePath) return { ok: false, error: 'STATE_PATH is required' };

  const maxPages = env.MAX_PAGES ? Number(env.MAX_PAGES) : 200;
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    return { ok: false, error: `MAX_PAGES must be a positive number, got "${env.MAX_PAGES}"` };
  }
  const maxTokens = env.MAX_TOKENS ? Number(env.MAX_TOKENS) : 500_000;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { ok: false, error: `MAX_TOKENS must be a positive number, got "${env.MAX_TOKENS}"` };
  }

  return {
    ok: true,
    config: {
      statePath,
      maxPages,
      maxTokens,
      userAgent: `${site.name} Discovery Agent (+${site.repoUrl}; ${site.contactEmail})`,
      extract: {
        apiKey,
        baseUrl: env.LLM_BASE_URL ?? DEFAULT_EXTRACT_BASE_URL,
        model,
      },
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

  const options: PipelineOptions = {
    statePath: resolved.config.statePath,
    userAgent: resolved.config.userAgent,
    maxPages: resolved.config.maxPages,
    maxTokens: resolved.config.maxTokens,
    extract: resolved.config.extract,
    log: (message: string) => console.error(message),
  };
  const result = await runPipeline(options);

  for (const error of result.errors) console.error(`ERROR ${error.source}: ${error.message}`);
  console.log(JSON.stringify(result.candidates, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
