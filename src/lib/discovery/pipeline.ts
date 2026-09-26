import { loadValidationContext, validateEvent, type ValidationContext } from '../validation';
import { todayUTC, type ISODate } from '../dates';
import type { RawEvent } from '../types';
import { draftFilePath, synthesizeDraft } from './draft';
import { extractEvent, type ExtractOptions } from './extract-client';
import { politeFetch, type FetchOptions } from './fetch';
import type { ExtractionInput } from './html';
import { extractionInputFromPage } from './parsers/page';
import { findEventPageLinks } from './parsers/listing';
import { parseFeedItems } from './parsers/rss';
import { parseICalFeed } from './parsers/ical';
import { extractionInputsFromChannel } from './parsers/telegram';
import { loadSources, type Source } from './sources';
import { loadState, saveState, type PageState } from './state';

/**
 * Caps the text sent to the extraction model. A large or hostile page (or a
 * listing with many child pages) would otherwise be sent at full size, with
 * unbounded token cost and a real risk of a context-length failure from the
 * model. 8000 characters is generous for any real conference/workshop
 * page's readable content.
 */
const EXTRACTION_TEXT_LIMIT = 8000;

function truncateForExtraction(text: string): string {
  return text.length > EXTRACTION_TEXT_LIMIT ? text.slice(0, EXTRACTION_TEXT_LIMIT) : text;
}

/**
 * Generic anchor terms beyond data/topics.yaml's own vocabulary — a
 * prolific listing source (GRC's find-a-conference page covers every
 * discipline it runs, not just chemistry) can otherwise send hundreds of
 * pages with zero on-topic content to the extraction model. Kept
 * deliberately broad: a false negative here silently drops a page before
 * any human ever sees it, which is worse than an occasional wasted call
 * the model itself would have rejected anyway.
 */
const RELEVANCE_GENERIC_TERMS = [
  'computational chemistry',
  'theoretical chemistry',
  'quantum chemistry',
  'molecular simulation',
  'ab initio',
  'first principles',
  'first-principles',
  'chemistry',
  'chemical',
];

function relevanceKeywords(topicSlugs: readonly string[]): string[] {
  return [...RELEVANCE_GENERIC_TERMS, ...topicSlugs.map((slug) => slug.replace(/-/g, ' '))];
}

function looksRelevant(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

export interface PipelineOptions {
  sourcesPath?: string;
  statePath: string;
  userAgent: string;
  maxPages: number;
  maxTokens: number;
  /**
   * Caps pages fetched from any single top-level source — a prolific
   * listing page (GRC's find-a-conference page discovered hundreds of
   * unrelated-discipline links in one run) must not be able to consume the
   * whole shared `maxPages` budget and starve every source after it.
   * Optional so existing callers don't need updating; defaults to 40.
   */
  maxPagesPerSource?: number;
  today?: ISODate;
  fetchImpl?: typeof fetch;
  /** See `FetchOptions.browserFetchImpl` — undefined in tests, so nothing launches a real browser. */
  browserFetchImpl?: (url: string, userAgent: string) => Promise<string>;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => Date;
  extract: Omit<ExtractOptions, 'topics'>;
  log?: (message: string) => void;
}

export interface PipelineResult {
  candidates: RawEvent[];
  errors: Array<{ source: string; message: string }>;
  tokensUsed: number;
}

/** Fetches every source in data/sources.yaml, extracts and validates candidates. Never opens a PR. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const sources = loadSources(options.sourcesPath);
  const state = loadState(options.statePath);
  const today = options.today ?? todayUTC();
  const ctx: ValidationContext = loadValidationContext('.', today);
  const log = options.log ?? (() => {});
  const keywords = relevanceKeywords([...ctx.topics]);
  let tokensUsed = 0;
  const extractOptions: ExtractOptions = {
    ...options.extract,
    topics: [...ctx.topics],
    onUsage: (tokens) => {
      tokensUsed += tokens;
    },
  };

  const candidates: RawEvent[] = [];
  const errors: Array<{ source: string; message: string }> = [];
  let pagesFetched = 0;
  let pagesFetchedForSource = 0;
  const maxPagesPerSource = options.maxPagesPerSource ?? 40;

  const fetchOpts: FetchOptions = {
    state,
    userAgent: options.userAgent,
    fetchImpl: options.fetchImpl,
    browserFetchImpl: options.browserFetchImpl,
    sleepImpl: options.sleepImpl,
    now: options.now,
  };

  async function fetchPage(url: string): Promise<string | undefined> {
    if (pagesFetched >= options.maxPages) {
      log(`max pages (${options.maxPages}) reached, skipping ${url}`);
      return undefined;
    }
    if (pagesFetchedForSource >= maxPagesPerSource) {
      log(`max pages per source (${maxPagesPerSource}) reached, skipping ${url}`);
      return undefined;
    }
    const result = await politeFetch(url, fetchOpts);
    if (result.status === 'fetched') {
      pagesFetched += 1;
      pagesFetchedForSource += 1;
      return result.body;
    }
    if (result.status === 'unchanged') log(`unchanged: ${url}`);
    else if (result.status === 'skipped') log(`skipped (${result.reason}): ${url}`);
    else log(`error fetching ${url}: ${result.error}`);
    return undefined;
  }

  function acceptDraft(draft: RawEvent, sourceUrl: string): void {
    const result = validateEvent({ file: draftFilePath(draft), data: draft }, ctx);
    if (result.errors.length > 0) {
      log(`dropped candidate from ${sourceUrl}: ${result.errors.map((e) => e.message).join('; ')}`);
      return;
    }
    candidates.push(draft);
  }

  /**
   * A single item's extraction/validation failure (a transient LLM API
   * failure, a malformed completion, a context-length error — all routine,
   * expected occurrences) is caught here, logged with enough detail to
   * identify which URL it was, and never rethrown: it must not abort
   * sibling items from the same fetched body, and must not be recorded in
   * `PipelineResult.errors` (that's reserved for genuinely unexpected
   * failures). Returns `false` only for such a real error — "no event
   * found" and "dropped by validation" are normal outcomes and return
   * `true`, same as success, so the caller knows whether it's safe to
   * commit this fetch's page state.
   */
  async function processInput(input: ExtractionInput): Promise<boolean> {
    if (tokensUsed >= options.maxTokens) {
      log(`max tokens (${options.maxTokens}) reached, skipping ${input.sourceUrl}`);
      // Unlike "no event found" or "dropped by validation", this item was
      // never actually looked at — its page state must not commit, or a
      // future run sees the page as unchanged and never retries it,
      // silently losing the event. See fetchAndProcess's doc comment.
      return false;
    }
    if (!looksRelevant(input.text, keywords)) {
      log(`skipping (off-topic): ${input.sourceUrl}`);
      // A genuine "nothing here" outcome, same as "no event found" from
      // the model itself — the page state commits normally.
      return true;
    }
    try {
      const fields = await extractEvent(truncateForExtraction(input.text), extractOptions);
      if (!fields) return true;
      const draft = synthesizeDraft(
        {
          title: fields.title,
          type: fields.type,
          start_date: fields.start_date,
          end_date: fields.end_date,
          format: fields.format,
          location: fields.location,
          // The model may honestly have no canonical event URL to report
          // (never fabricated) — fall back to the URL the pipeline itself
          // fetched this content from, the same value already used for
          // source_url.
          url: fields.url ?? input.sourceUrl,
          source_url: input.sourceUrl,
          organizer: fields.organizer,
          cost: fields.cost,
          topics: fields.topics,
          description: fields.description,
        },
        today,
      );
      acceptDraft(draft, input.sourceUrl);
      return true;
    } catch (err) {
      log(
        `extraction failed for ${input.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  function capturePageState(url: string): PageState | undefined {
    const existing = state.pages[url];
    return existing ? { ...existing } : undefined;
  }

  function restorePageState(url: string, previous: PageState | undefined): void {
    if (previous === undefined) delete state.pages[url];
    else state.pages[url] = previous;
  }

  /**
   * Fetches `url` and, if a body came back, runs `process` over it.
   * `politeFetch` (via `fetchPage`) writes the new etag/contentHash/
   * fetchedAt into `state.pages[url]` as soon as the body arrives, before
   * anything is extracted or validated. If `process` throws (a genuinely
   * unexpected failure) or reports that some item from this body could not
   * be fully processed (returns `false`), that write is rolled back to
   * whatever `state.pages[url]` was before this call — so a future run
   * re-fetches and retries instead of treating the URL as permanently
   * "seen" from a fetch whose content was never fully handled. A normal
   * empty/no-event/dropped-by-validation outcome is not an error and
   * commits the new fetch state as usual.
   */
  async function fetchAndProcess(
    url: string,
    process: (body: string) => Promise<boolean>,
  ): Promise<void> {
    const previous = capturePageState(url);
    const body = await fetchPage(url);
    if (body === undefined) return;
    let ok: boolean;
    try {
      ok = await process(body);
    } catch (err) {
      restorePageState(url, previous);
      throw err;
    }
    if (!ok) restorePageState(url, previous);
  }

  async function processSource(source: Source): Promise<void> {
    switch (source.kind) {
      case 'ical': {
        await fetchAndProcess(source.url, async (body) => {
          for (const draft of parseICalFeed(body, source.url, today))
            acceptDraft(draft, source.url);
          return true;
        });
        return;
      }
      case 'rss': {
        await fetchAndProcess(source.url, async (body) => {
          let allOk = true;
          for (const input of parseFeedItems(body, source.url)) {
            if (!(await processInput(input))) allOk = false;
          }
          return allOk;
        });
        return;
      }
      case 'event-page': {
        await fetchAndProcess(source.url, (body) =>
          processInput(extractionInputFromPage(body, source.url)),
        );
        return;
      }
      case 'listing-page':
      case 'mailing-list-archive': {
        await fetchAndProcess(source.url, async (body) => {
          for (const link of findEventPageLinks(body, source.url)) {
            await fetchAndProcess(link, (pageBody) =>
              processInput(extractionInputFromPage(pageBody, link)),
            );
          }
          // A child page's own failure is handled (and retried) at that
          // child's own URL via the nested fetchAndProcess above; it does
          // not make the listing page itself un-"seen".
          return true;
        });
        return;
      }
      case 'telegram-channel': {
        await fetchAndProcess(source.url, async (body) => {
          let allOk = true;
          for (const input of extractionInputsFromChannel(body)) {
            if (!(await processInput(input))) allOk = false;
          }
          return allOk;
        });
        return;
      }
      case 'mailbox':
        log(`mailbox source "${source.name}" is not implemented, skipping`);
    }
  }

  for (const source of sources) {
    pagesFetchedForSource = 0;
    try {
      await processSource(source);
    } catch (err) {
      errors.push({
        source: source.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  saveState(options.statePath, state);
  return { candidates, errors, tokensUsed };
}
