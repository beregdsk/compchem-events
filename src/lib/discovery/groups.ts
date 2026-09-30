// The groups pass's lead resolver: registry match → name split → listing
// link or web search → forced fetch → verification → draft. Spec:
// docs/superpowers/specs/2026-09-29-groups-registry-design.md, steps 1–5 and 7–8.
import { daysBetween, type ISODate } from '../dates';
import { normaliseGroupName, validateGroup } from '../group-validation';
import type { RawGroup } from '../types';
import { loadValidationContext } from '../validation';
import { normalizeEventUrl, type ExtractOptions } from './extract-client';
import { politeFetch, type FetchOptions } from './fetch';
import { groupFilePath, synthesizeGroupDraft } from './group-draft';
import { extractGroup, splitNames, type ExtractedGroup, type NameItem } from './group-extract';
import {
  canBeGroupWebsite,
  isProfileHost,
  matchName,
  splitOrganizer,
  type RegistryIndex,
} from './group-match';
import { isPublicHttpsUrl, searchGroupWebsites } from './group-search';
import type { GroupLead } from './parsers/group-listing';
import { extractionInputFromPage } from './parsers/page';
import type { DiscoveryState } from './state';

/** A name with any outcome other than a PR opened is not looked up again for this long. */
export const LOOKUP_TTL_DAYS = 90;
/** Search results fetched and verified per name, in citation order. */
const SEARCH_CANDIDATES = 2;
/**
 * Leads resolved at once. Every step is a slow model call or fetch, so one at
 * a time leaves the run idle; politeFetch still spaces requests per host.
 */
const LOOKUP_CONCURRENCY = 4;

export interface GroupCandidate {
  draft: RawGroup;
  confidence: number;
  lead: GroupLead;
  /** The `state.groupLookups` key this candidate was cached under. */
  lookupKey: string;
  /** Every URL fetched for this name, with what came of it. */
  considered: Array<{ url: string; verdict: string }>;
}

export interface ResolveOptions {
  leads: readonly GroupLead[];
  index: RegistryIndex;
  takenIds: ReadonlySet<string>;
  state: DiscoveryState;
  fetch: Omit<FetchOptions, 'state'>;
  extract: ExtractOptions;
  maxSearches: number;
  maxPages: number;
  maxTokens: number;
  tokensUsedSoFar: number;
  today: ISODate;
  now?: () => Date;
  log?: (m: string) => void;
}

export interface ResolveResult {
  candidates: GroupCandidate[];
  searches: number;
  pagesFetched: number;
  tokensUsed: number;
  errors: Array<{ source: string; message: string }>;
}

type Item = NameItem & { context?: string };
type Verified = { fields: ExtractedGroup; website: string };
type Considered = GroupCandidate['considered'];

/** Drops cached lookups, e.g. for names whose PR was closed so they may be tried again. */
export function forgetLookups(state: DiscoveryState, keys: readonly string[]): void {
  for (const key of keys) delete state.groupLookups[key];
}

export async function resolveGroupLeads(options: ResolveOptions): Promise<ResolveResult> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const ctx = loadValidationContext('.', options.today);
  const takenIds = new Set(options.takenIds);
  const handled = new Set<string>();
  const result: ResolveResult = {
    candidates: [],
    searches: 0,
    pagesFetched: 0,
    tokensUsed: 0,
    errors: [],
  };
  const extract: ExtractOptions = {
    ...options.extract,
    onUsage: (t) => {
      result.tokensUsed += t;
      options.extract.onUsage?.(t);
    },
  };
  const outOfTokens = () => options.tokensUsedSoFar + result.tokensUsed >= options.maxTokens;
  const fresh = (key: string) => {
    const hit = options.state.groupLookups[key];
    return (
      hit !== undefined &&
      daysBetween(hit.triedAt.slice(0, 10), now().toISOString().slice(0, 10)) < LOOKUP_TTL_DAYS
    );
  };
  const remember = (key: string, outcome: string) => {
    options.state.groupLookups[key] = { triedAt: now().toISOString(), outcome };
  };

  /** A listing lead is one name; any other lead is split, and only its unmatched parts reach the model. */
  async function itemsOf(lead: GroupLead): Promise<Item[]> {
    if (lead.fromListing) {
      const type = lead.link && isProfileHost(lead.link) ? 'person' : 'organisation';
      return [{ name: lead.text, type, context: lead.context }];
    }
    const unmatched = splitOrganizer(lead.text).filter((p) => !matchName(options.index, p.name));
    if (unmatched.length === 0) return [];
    // An organiser has no link, so it can only be found by searching; once the
    // searches are spent, splitting it is a model call for names all capped anyway.
    if (result.searches >= options.maxSearches) {
      log(`groups: ${lead.text}: MAX_SEARCHES reached, left for the next run`);
      return [];
    }
    const text = unmatched
      .map((p) => (p.affiliation ? `${p.name} (${p.affiliation})` : p.name))
      .join('; ');
    return (await splitNames(text, extract)).map((i) => ({
      ...i,
      context: i.affiliation ?? lead.context,
    }));
  }

  /** A group's website is never a profile or reference page, nor on the host the lead came from. */
  const onOtherHost = (url: string, originHost: string) =>
    canBeGroupWebsite(url) && new URL(url).host.toLowerCase() !== originHost;

  /** Fetches one URL and asks the model whether it is this item's homepage; `capped` when MAX_PAGES stopped it. */
  async function verify(
    url: string,
    item: Item,
    originHost: string,
    considered: Considered,
  ): Promise<Verified | 'capped' | undefined> {
    if (result.pagesFetched >= options.maxPages) {
      log(`groups: ${item.name}: MAX_PAGES reached, left for the next run`);
      return 'capped';
    }
    result.pagesFetched += 1;
    const page = await politeFetch(url, { ...options.fetch, state: options.state, force: true });
    if (page.status !== 'fetched') {
      considered.push({
        url,
        verdict: page.status === 'error' ? `error: ${page.error}` : page.status,
      });
      return undefined;
    }
    if (!isPublicHttpsUrl(page.finalUrl)) {
      considered.push({ url, verdict: 'redirected to a non-public host' });
      return undefined;
    }
    if (!onOtherHost(page.finalUrl, originHost)) {
      considered.push({ url, verdict: 'redirected to a profile or origin host' });
      return undefined;
    }
    const pageText = extractionInputFromPage(page.body, page.finalUrl).text;
    const fields = await extractGroup(pageText, item, extract);
    considered.push({ url, verdict: fields ? 'drafted' : 'not this group' });
    return fields ? { fields, website: page.finalUrl } : undefined;
  }

  /** The listing link first, then up to SEARCH_CANDIDATES search results; `capped` when a cap stopped the lookup. */
  async function lookUp(
    lead: GroupLead,
    item: Item,
    considered: Considered,
  ): Promise<Verified | 'capped' | undefined> {
    const originHost = new URL(lead.origin).host.toLowerCase();
    const link = lead.link ? normalizeEventUrl(lead.link) : null;
    if (link && isPublicHttpsUrl(link) && onOtherHost(link, originHost)) {
      const found = await verify(link, item, originHost, considered);
      if (found) return found;
    }
    if (result.searches >= options.maxSearches) {
      log(`groups: ${item.name}: MAX_SEARCHES reached, left for the next run`);
      return 'capped';
    }
    result.searches += 1;
    const context = item.context ? ` ${item.context}` : '';
    const query =
      item.type === 'person'
        ? `"${item.name}" research group${context}`
        : `"${item.name}"${context}`;
    const urls = (await searchGroupWebsites(query, extract)).filter((u) =>
      onOtherHost(u, originHost),
    );
    for (const url of urls.slice(0, SEARCH_CANDIDATES)) {
      const found = await verify(url, item, originHost, considered);
      if (found) return found;
    }
    return undefined;
  }

  let outOfTokensLogged = false;
  const stopForTokens = () => {
    if (!outOfTokens()) return false;
    if (!outOfTokensLogged) log('groups: MAX_TOKENS reached');
    outOfTokensLogged = true;
    return true;
  };

  /** One lead's names, looked up in turn; its drafts go in `found`, in order. */
  async function resolveLead(lead: GroupLead, found: GroupCandidate[]): Promise<void> {
    let items: Item[];
    try {
      items = await itemsOf(lead);
    } catch (err) {
      result.errors.push({
        source: lead.origin,
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const item of items) {
      if (stopForTokens()) return;
      if (matchName(options.index, item.name)) continue;
      const key = normaliseGroupName(item.name);
      if (handled.has(key) || fresh(key)) {
        log(`groups: ${item.name}: cached`);
        continue;
      }
      handled.add(key);
      const considered: Considered = [];
      try {
        const verified = await lookUp(lead, item, considered);
        if (verified === 'capped') continue;
        if (!verified) {
          remember(key, 'not found');
          continue;
        }
        const draft = synthesizeGroupDraft(
          verified.fields,
          verified.website,
          item.name,
          takenIds,
          options.today,
        );
        const errors = validateGroup({ file: groupFilePath(draft), data: draft }, ctx).errors;
        if (errors.length > 0) {
          const verdict = `invalid: ${errors.map((e) => `${e.field} ${e.message}`).join('; ')}`;
          considered[considered.length - 1]!.verdict = verdict;
          log(`groups: ${item.name}: ${verdict}`);
          remember(key, verdict);
          continue;
        }
        takenIds.add(draft.id);
        remember(key, 'drafted');
        found.push({
          draft,
          confidence: verified.fields.confidence,
          lead,
          lookupKey: key,
          considered,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        remember(key, `error: ${message}`);
        result.errors.push({ source: lead.origin, message: `${item.name}: ${message}` });
      }
    }
  }

  // A fixed pool of workers pulling leads from one queue. Budgets are checked
  // and counted with no await in between, so workers can't overshoot them;
  // `handled` and `takenIds` likewise change synchronously. Drafts are kept
  // per lead so the result is in lead order however the workers interleave.
  const perLead: GroupCandidate[][] = options.leads.map(() => []);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < options.leads.length && !stopForTokens()) {
      const i = next++;
      await resolveLead(options.leads[i]!, perLead[i]!);
    }
  }
  await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
  result.candidates = perLead.flat();
  return result;
}
