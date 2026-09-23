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
import { loadState, saveState } from './state';

export interface PipelineOptions {
  sourcesPath?: string;
  statePath: string;
  userAgent: string;
  maxPages: number;
  today?: ISODate;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => Date;
  extract: Omit<ExtractOptions, 'topics'>;
  log?: (message: string) => void;
}

export interface PipelineResult {
  candidates: RawEvent[];
  errors: Array<{ source: string; message: string }>;
}

/** Fetches every source in data/sources.yaml, extracts and validates candidates. Never opens a PR. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const sources = loadSources(options.sourcesPath);
  const state = loadState(options.statePath);
  const today = options.today ?? todayUTC();
  const ctx: ValidationContext = loadValidationContext('.', today);
  const log = options.log ?? (() => {});
  const extractOptions: ExtractOptions = { ...options.extract, topics: [...ctx.topics] };

  const candidates: RawEvent[] = [];
  const errors: Array<{ source: string; message: string }> = [];
  let pagesFetched = 0;

  const fetchOpts: FetchOptions = {
    state,
    userAgent: options.userAgent,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    now: options.now,
  };

  async function fetchPage(url: string): Promise<string | undefined> {
    if (pagesFetched >= options.maxPages) {
      log(`max pages (${options.maxPages}) reached, skipping ${url}`);
      return undefined;
    }
    const result = await politeFetch(url, fetchOpts);
    if (result.status === 'fetched') {
      pagesFetched += 1;
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

  async function processInput(input: ExtractionInput): Promise<void> {
    const fields = await extractEvent(input.text, extractOptions);
    if (!fields) return;
    const draft = synthesizeDraft(
      {
        title: fields.title,
        type: fields.type,
        start_date: fields.start_date,
        end_date: fields.end_date,
        format: fields.format,
        location: fields.location,
        url: fields.url,
        source_url: input.sourceUrl,
        organizer: fields.organizer,
        topics: fields.topics,
        description: fields.description,
      },
      today,
    );
    acceptDraft(draft, input.sourceUrl);
  }

  async function processSource(source: Source): Promise<void> {
    switch (source.kind) {
      case 'ical': {
        const body = await fetchPage(source.url);
        if (body === undefined) return;
        for (const draft of parseICalFeed(body, source.url, today)) acceptDraft(draft, source.url);
        return;
      }
      case 'rss': {
        const body = await fetchPage(source.url);
        if (body === undefined) return;
        for (const input of parseFeedItems(body, source.url)) await processInput(input);
        return;
      }
      case 'event-page': {
        const body = await fetchPage(source.url);
        if (body === undefined) return;
        await processInput(extractionInputFromPage(body, source.url));
        return;
      }
      case 'listing-page':
      case 'mailing-list-archive': {
        const body = await fetchPage(source.url);
        if (body === undefined) return;
        for (const link of findEventPageLinks(body, source.url)) {
          const pageBody = await fetchPage(link);
          if (pageBody === undefined) continue;
          await processInput(extractionInputFromPage(pageBody, link));
        }
        return;
      }
      case 'telegram-channel': {
        const body = await fetchPage(source.url);
        if (body === undefined) return;
        for (const input of extractionInputsFromChannel(body)) await processInput(input);
        return;
      }
      case 'mailbox':
        log(`mailbox source "${source.name}" is not implemented, skipping`);
    }
  }

  for (const source of sources) {
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
  return { candidates, errors };
}
