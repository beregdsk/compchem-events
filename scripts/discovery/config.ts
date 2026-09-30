// The discovery agent's configuration from the environment, shared by the
// nightly run and the groups crawler (which run.ts itself calls, so it cannot
// import run.ts back).
import { site } from '../../site.config';
import { DEFAULT_JEV_MODEL } from '../../src/lib/discovery/classify-candidate';
import { DEFAULT_EXTRACT_BASE_URL } from '../../src/lib/discovery/extract-client';
import { DEFAULT_JEV_BASE_URL } from '../../src/lib/discovery/jev-client';
import type { MailboxCredentials } from '../../src/lib/discovery/mailbox-client';

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
