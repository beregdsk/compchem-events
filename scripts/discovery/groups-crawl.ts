#!/usr/bin/env node
// The groups crawler's runner: one big crawl by hand, and the nightly slice
// from run.ts. Spec: docs/superpowers/specs/2026-09-30-groups-crawler-design.md.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { daysBetween, todayUTC, type ISODate } from '../../src/lib/dates';
import { loadGroups } from '../../src/lib/groups';
import { loadPositions } from '../../src/lib/positions';
import type { RawGroup, RawPosition, Topic } from '../../src/lib/types';
import { loadTopics, loadValidationContext } from '../../src/lib/validation';
import { buildBackfillPrBody, CRAWL_INTRO } from '../../src/lib/discovery/batch-pr-body';
import { fetchWithBrowser } from '../../src/lib/discovery/browser-fetch';
import { ADD_THRESHOLD } from '../../src/lib/discovery/classify-candidate';
import { runCrawl } from '../../src/lib/discovery/crawl/crawl';
import { enqueue, loadCrawlState, saveCrawlState } from '../../src/lib/discovery/crawl/frontier';
import {
  listingSeeds,
  openalexSeedUrls,
  positionSeeds,
  registrySeeds,
  searchQueries,
  searchSeeds,
  SEED_PRIORITY,
} from '../../src/lib/discovery/crawl/seeds';
import { seedHostOf } from '../../src/lib/discovery/crawl/score';
import { serializeDraft } from '../../src/lib/discovery/draft';
import type { ExtractOptions } from '../../src/lib/discovery/extract-client';
import type { FetchOptions } from '../../src/lib/discovery/fetch';
import type { GitHubOptions } from '../../src/lib/discovery/github-client';
import { groupFilePath } from '../../src/lib/discovery/group-draft';
import { buildRegistryIndex } from '../../src/lib/discovery/group-match';
import {
  forgetLookups,
  resolveGroupLeads,
  type GroupCandidate,
} from '../../src/lib/discovery/groups';
import { CRAWL_BRANCH_PREFIX, openGroupDrafts } from '../../src/lib/discovery/groups-pass';
import { groupSkipReason } from '../../src/lib/discovery/orchestrator';
import { Proposer } from '../../src/lib/discovery/propose';
import { loadSources, type Source } from '../../src/lib/discovery/sources';
import { loadState, saveState } from '../../src/lib/discovery/state';
import type { OpenAlexOptions } from '../../src/lib/topics/openalex';
import { buildConfig } from './run';

const BATCH = 50;
const OPENALEX_SEED_DAYS = 30;

export interface CrawlArgs {
  maxPages: number;
  maxClassify: number;
  maxSearches: number;
  maxPrs: number;
  maxTokens?: number;
  model?: string;
}

const INT_FLAGS = {
  '--max-pages': 'maxPages',
  '--max-classify': 'maxClassify',
  '--max-searches': 'maxSearches',
  '--max-prs': 'maxPrs',
  '--max-tokens': 'maxTokens',
} as const;

export function parseCrawlArgs(argv: string[]): CrawlArgs {
  const args: CrawlArgs = { maxPages: 200, maxClassify: 40, maxSearches: 5, maxPrs: 1 };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (flag === '--model') {
      if (!value) throw new Error('--model needs a model id');
      args.model = value;
      continue;
    }
    if (!Object.hasOwn(INT_FLAGS, flag)) throw new Error(`unknown argument "${flag}"`);
    if (value === undefined || !/^[1-9]\d*$/.test(value))
      throw new Error(`${flag} needs a positive integer, got "${value ?? ''}"`);
    args[INT_FLAGS[flag as keyof typeof INT_FLAGS]] = Number(value);
  }
  return args;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(path: string, pid = process.pid): boolean {
  if (existsSync(path)) {
    const held = Number(readFileSync(path, 'utf8').trim());
    if (Number.isInteger(held) && held > 0 && alive(held)) return false;
  }
  writeFileSync(path, String(pid));
  return true;
}

export function releaseLock(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

export interface GroupsCrawlDeps {
  github: GitHubOptions;
  extract: ExtractOptions;
  fetch: Omit<FetchOptions, 'state' | 'force'>;
  statePath: string;
  crawlStatePath: string;
  lockPath: string;
  today: ISODate;
  args: CrawlArgs;
  maxTokens: number;
  blockedHosts: ReadonlySet<string>;
  openalex?: OpenAlexOptions;
  topics?: readonly Topic[];
  groups?: readonly RawGroup[];
  positions?: readonly RawPosition[];
  sources?: readonly Source[];
  log?: (m: string) => void;
}

export interface GroupsCrawlResult {
  status: 'locked' | 'done';
  pagesFetched: number;
  classified: number;
  leads: number;
  accepted: number;
  prs: number[];
  errors: string[];
  tokensUsed: number;
}

export async function runGroupsCrawl(deps: GroupsCrawlDeps): Promise<GroupsCrawlResult> {
  const log = deps.log ?? (() => {});
  const out: GroupsCrawlResult = {
    status: 'done',
    pagesFetched: 0,
    classified: 0,
    leads: 0,
    accepted: 0,
    prs: [],
    errors: [],
    tokensUsed: 0,
  };
  if (!acquireLock(deps.lockPath)) {
    log('groups crawl: another crawl holds the lock; skipping');
    return { ...out, status: 'locked' };
  }
  try {
    const state = loadState(deps.statePath);
    const crawl = loadCrawlState(deps.crawlStatePath);
    const save = () => {
      saveCrawlState(deps.crawlStatePath, crawl);
      saveState(deps.statePath, state);
    };
    const groups = deps.groups ?? loadGroups({ includeFixtures: false });
    const openDrafts = await openGroupDrafts(deps.github);
    const known = [...groups, ...openDrafts];

    const seeds = [
      ...registrySeeds(known),
      ...positionSeeds(deps.positions ?? loadPositions({ includeFixtures: false })),
      ...listingSeeds(deps.sources ?? loadSources()),
    ];
    const cached = crawl.openalexSeeds;
    if (cached && daysBetween(cached.fetchedAt, deps.today) < OPENALEX_SEED_DAYS) {
      seeds.push(
        ...cached.urls.map((url) => ({
          url,
          priority: SEED_PRIORITY.openalex,
          depth: 0,
          seedHost: seedHostOf(url),
        })),
      );
    } else if (deps.openalex) {
      try {
        const urls = await openalexSeedUrls(
          deps.topics ?? loadTopics(),
          Number(deps.today.slice(0, 4)),
          deps.openalex,
        );
        crawl.openalexSeeds = { fetchedAt: deps.today, urls };
        seeds.push(
          ...urls.map((url) => ({
            url,
            priority: SEED_PRIORITY.openalex,
            depth: 0,
            seedHost: seedHostOf(url),
          })),
        );
      } catch (err) {
        out.errors.push(`openalex seeds: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (deps.args.maxSearches > 0) {
      try {
        seeds.push(
          ...(await searchSeeds(
            searchQueries(crawl.searchCountryIndex, deps.args.maxSearches),
            deps.extract,
          )),
        );
      } catch (err) {
        out.errors.push(`search seeds: ${err instanceof Error ? err.message : String(err)}`);
      }
      crawl.searchCountryIndex += deps.args.maxSearches;
    }
    enqueue(crawl, seeds, deps.today);

    const crawled = await runCrawl({
      crawl,
      fetchState: state,
      fetch: deps.fetch,
      extract: deps.extract,
      today: deps.today,
      maxPages: deps.args.maxPages,
      maxClassify: deps.args.maxClassify,
      maxTokens: deps.maxTokens,
      tokensUsedSoFar: 0,
      save,
      log,
    });
    Object.assign(out, {
      pagesFetched: crawled.pagesFetched,
      classified: crawled.classified,
      leads: crawled.leads.length,
    });
    out.errors.push(...crawled.errors);

    const resolved = await resolveGroupLeads({
      leads: crawled.leads,
      index: buildRegistryIndex(known),
      takenIds: new Set(known.map((g) => g.id)),
      state,
      fetch: deps.fetch,
      extract: deps.extract,
      maxSearches: 0,
      maxPages: deps.args.maxPages,
      maxTokens: deps.maxTokens,
      tokensUsedSoFar: crawled.tokensUsed,
      today: deps.today,
      log,
    });
    out.tokensUsed = crawled.tokensUsed + resolved.tokensUsed;
    out.errors.push(...resolved.errors.map((e) => `${e.source}: ${e.message}`));

    const accepted: GroupCandidate[] = [];
    for (const c of resolved.candidates) {
      if (c.confidence < ADD_THRESHOLD) continue;
      if (groupSkipReason(c.draft, [...known, ...accepted.map((a) => a.draft)], deps.blockedHosts))
        continue;
      accepted.push(c);
    }
    accepted.sort((a, b) => a.lead.origin.localeCompare(b.lead.origin));
    out.accepted = accepted.length;

    const chunks: GroupCandidate[][] = [];
    for (let i = 0; i < accepted.length; i += BATCH) chunks.push(accepted.slice(i, i + BATCH));
    const proposer = new Proposer(deps.github);
    for (const [i, chunk] of chunks.entries()) {
      if (i >= deps.args.maxPrs) {
        forgetLookups(
          state,
          chunk.map((c) => c.lookupKey),
        );
        continue;
      }
      try {
        const p = await proposer.proposeBatch({
          branch: `${CRAWL_BRANCH_PREFIX}${deps.today}-${i + 1}`,
          files: chunk.map((c) => ({
            path: groupFilePath(c.draft),
            content: serializeDraft(c.draft),
          })),
          title: `Groups registry: crawl ${deps.today} (${i + 1}/${chunks.length})`,
          message: 'Add crawled registry entries',
          body: buildBackfillPrBody(chunk, [], [], CRAWL_INTRO),
          labels: ['needs-review', 'group'],
        });
        if (p.outcome === 'reviewed')
          forgetLookups(
            state,
            chunk.map((c) => c.lookupKey),
          );
        else out.prs.push(p.pr);
      } catch (err) {
        forgetLookups(
          state,
          chunk.map((c) => c.lookupKey),
        );
        out.errors.push(`batch ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    save();
    return out;
  } finally {
    releaseLock(deps.lockPath);
  }
}

async function main(): Promise<void> {
  const resolved = buildConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  const cfg = resolved.config;
  const args = parseCrawlArgs(process.argv.slice(2));
  const ctx = loadValidationContext();
  const dir = dirname(cfg.statePath);
  const result = await runGroupsCrawl({
    github: cfg.github,
    extract: { ...cfg.extract, model: args.model ?? cfg.extract.model, topics: [...ctx.topics] },
    fetch: { userAgent: cfg.userAgent, browserFetchImpl: fetchWithBrowser },
    statePath: cfg.statePath,
    crawlStatePath: process.env.CRAWL_STATE_PATH ?? join(dir, 'crawl-state.json'),
    lockPath: join(dir, 'crawl.lock'),
    today: todayUTC(),
    args,
    maxTokens: args.maxTokens ?? cfg.maxTokens,
    blockedHosts: ctx.blockedHosts,
    openalex: { mailto: site.contactEmail, apiKey: process.env.OPENALEX_API_KEY || undefined },
    log: (m) => console.error(m),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
