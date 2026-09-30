// One bounded crawl run: take the best frontier entries four at a time on
// distinct hosts, fetch politely, queue in-scope links, classify likely
// directories, collect group leads. Spec:
// docs/superpowers/specs/2026-09-30-groups-crawler-design.md.
import type { ISODate } from '../../dates';
import { normalizeEventUrl, type ExtractOptions } from '../extract-client';
import { politeFetch, type FetchOptions } from '../fetch';
import { isPublicHttpsUrl } from '../group-search';
import { htmlToText, parseHTML } from '../html';
import type { GroupLead } from '../parsers/group-listing';
import type { DiscoveryState } from '../state';
import { classifyPage, leadsFrom, pageLinks, passesGate } from './classify';
import { enqueue, markVisited, takeNext, type CrawlState, type QueueEntry } from './frontier';
import { inScope, linkScore, MAX_DEPTH, MAX_PAGES_PER_HOST, priorityOf } from './score';

export interface CrawlDeps {
  crawl: CrawlState;
  fetchState: DiscoveryState;
  fetch: Omit<FetchOptions, 'state' | 'force'>;
  extract: ExtractOptions;
  today: ISODate;
  maxPages: number;
  maxClassify: number;
  maxTokens: number;
  tokensUsedSoFar: number;
  save: () => void;
  log?: (m: string) => void;
}
export interface CrawlResult {
  leads: GroupLead[];
  pagesFetched: number;
  classified: number;
  tokensUsed: number;
  errors: string[];
}

export const SAVE_EVERY = 50;
export const CONCURRENCY = 4;
const CHOSEN_PRIORITY = 10;

export async function runCrawl(deps: CrawlDeps): Promise<CrawlResult> {
  const log = deps.log ?? (() => {});
  const result: CrawlResult = {
    leads: [],
    pagesFetched: 0,
    classified: 0,
    tokensUsed: 0,
    errors: [],
  };
  const extract: ExtractOptions = {
    ...deps.extract,
    onUsage: (t) => {
      result.tokensUsed += t;
      deps.extract.onUsage?.(t);
    },
  };
  const perHost = new Map<string, number>();
  const paused = new Set<string>();
  const leadLinks = new Set<string>();
  /** Unvisited pages to try next run; re-queued only after the loop, so this run never refetches them. */
  const deferred: QueueEntry[] = [];
  const hostCap = Math.min(MAX_PAGES_PER_HOST, Math.max(1, Math.floor(deps.maxPages / 4)));
  const outOfTokens = () => deps.tokensUsedSoFar + result.tokensUsed >= deps.maxTokens;
  let lastSave = 0;

  async function visit(entry: QueueEntry): Promise<void> {
    const url = normalizeEventUrl(entry.url);
    if (!url || !isPublicHttpsUrl(url)) {
      markVisited(deps.crawl, entry.url, 'skipped', deps.today);
      return;
    }
    const host = new URL(url).host;
    result.pagesFetched += 1;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    const hadPage = url in deps.fetchState.pages;
    const page = await politeFetch(url, { ...deps.fetch, state: deps.fetchState, force: true });
    if (!hadPage) delete deps.fetchState.pages[url];

    if (page.status === 'error') {
      if (/^(429|503)\b/.test(page.error)) paused.add(host);
      markVisited(deps.crawl, url, 'error', deps.today);
      result.errors.push(`${url}: ${page.error}`);
      return;
    }
    if (page.status !== 'fetched') {
      markVisited(deps.crawl, url, 'skipped', deps.today);
      return;
    }
    if (!isPublicHttpsUrl(page.finalUrl) || !inScope(page.finalUrl, entry.seedHost)) {
      markVisited(deps.crawl, url, 'skipped', deps.today);
      return;
    }
    const doc = parseHTML(page.body);
    const links = pageLinks(doc, page.finalUrl);
    const next = entry.depth + 1;
    if (next <= MAX_DEPTH) {
      enqueue(
        deps.crawl,
        links.flatMap((l) => {
          const u = normalizeEventUrl(l.url);
          return u && inScope(u, entry.seedHost)
            ? [
                {
                  url: u,
                  priority: priorityOf(linkScore(u, l.text), next),
                  depth: next,
                  seedHost: entry.seedHost,
                },
              ]
            : [];
        }),
        deps.today,
      );
    }
    if (!passesGate(doc, links)) {
      markVisited(deps.crawl, url, 'not-classified', deps.today);
      return;
    }
    if (result.classified >= deps.maxClassify || outOfTokens()) {
      deferred.push(entry);
      return;
    }
    result.classified += 1;
    let verdict;
    try {
      verdict = await classifyPage(htmlToText(doc), links, extract);
    } catch (err) {
      result.errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      deferred.push(entry);
      return;
    }
    const title =
      (doc.querySelector('title')?.textContent ?? '').replace(/\s+/g, ' ').trim() || url;
    for (const lead of leadsFrom(verdict, links, url, title)) {
      if (!lead.link || leadLinks.has(lead.link)) continue;
      leadLinks.add(lead.link);
      result.leads.push(lead);
      const u = normalizeEventUrl(lead.link);
      if (u && next <= MAX_DEPTH && inScope(u, entry.seedHost)) {
        enqueue(
          deps.crawl,
          [{ url: u, priority: CHOSEN_PRIORITY, depth: next, seedHost: entry.seedHost }],
          deps.today,
        );
      }
    }
    markVisited(deps.crawl, url, verdict.kind, deps.today);
  }

  while (result.pagesFetched < deps.maxPages && !outOfTokens()) {
    const room = Math.min(CONCURRENCY, deps.maxPages - result.pagesFetched);
    const batch = takeNext(deps.crawl, room, perHost, hostCap, paused);
    if (batch.length === 0) break;
    await Promise.all(
      batch.map((e) =>
        visit(e).catch((err: unknown) => {
          result.errors.push(`${e.url}: ${err instanceof Error ? err.message : String(err)}`);
          markVisited(deps.crawl, e.url, 'error', deps.today);
        }),
      ),
    );
    if (result.pagesFetched - lastSave >= SAVE_EVERY) {
      deps.save();
      lastSave = result.pagesFetched - (result.pagesFetched % SAVE_EVERY);
    }
  }
  enqueue(deps.crawl, deferred, deps.today);
  deps.save();
  log(
    `crawl: ${result.pagesFetched} pages, ${result.classified} classified, ${result.leads.length} leads`,
  );
  return result;
}
