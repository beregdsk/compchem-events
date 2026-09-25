import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';

const icalBody = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:ical-1@example.org
DTSTART;VALUE=DATE:20270301
DTEND;VALUE=DATE:20270303
SUMMARY:Online Workshop From Ical
URL:https://example.org/ical-workshop
END:VEVENT
END:VCALENDAR`;

const eventPageBody =
  '<html><body><h1>Event Page Workshop</h1>\n<p>Details in Testville.</p></body></html>';
const listingBody = '<html><body><a href="/listing/child">Child Event</a></body></html>';
const listingChildBody =
  '<html><body><h1>Listing Child Workshop</h1>\n<p>Details.</p></body></html>';
const brokenPageBody = '<html><body><h1>Broken Page</h1></body></html>';
const noUrlPageBody = '<html><body><h1>No Url Workshop</h1>\n<p>Details.</p></body></html>';

// The description is deliberately HTML markup (Fix B): the pipeline test
// only needs to prove the run completes and produces a candidate — the
// plain-text conversion itself is covered in detail by
// tests/discovery/parsers/rss.test.ts.
const rssBody = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>RSS Feed Workshop</title>
    <description>&lt;p&gt;Details in Testville.&lt;/p&gt;</description>
    <link>https://example.org/rss-workshop</link>
  </item>
</channel></rss>`;

const telegramBody = `
  <div class="tgme_widget_message" data-post="samplechannel/1">
    <div class="tgme_widget_message_text">Telegram Workshop Announcement</div>
  </div>`;

function extractedFor(title: string, url: string | null = 'https://example.org/extracted-event') {
  return {
    found: true,
    event: {
      title,
      type: 'workshop',
      start_date: '2027-05-01',
      end_date: '2027-05-03',
      format: 'online',
      location: null,
      url,
      organizer: null,
      topics: ['molecular-dynamics'],
      description: `A workshop: ${title}.`,
      confidence: 0.8,
    },
  };
}

function stubPageFetch() {
  const responses: Record<string, { status: number; body: string }> = {
    'https://example.org/robots.txt': { status: 200, body: '' },
    'https://broken.example/robots.txt': { status: 200, body: '' },
    'https://example.org/calendar.ics': { status: 200, body: icalBody },
    'https://example.org/event': { status: 200, body: eventPageBody },
    'https://example.org/listing': { status: 200, body: listingBody },
    'https://example.org/listing/child': { status: 200, body: listingChildBody },
    'https://broken.example/page': { status: 200, body: brokenPageBody },
    'https://example.org/feed.xml': { status: 200, body: rssBody },
    'https://example.org/telegram': { status: 200, body: telegramBody },
    'https://example.org/no-url': { status: 200, body: noUrlPageBody },
  };
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const r = responses[url];
    if (!r) throw new Error(`unstubbed url: ${url}`);
    return new Response(r.body, { status: r.status });
  }) as typeof fetch;
}

/**
 * Every input gets a canned "found" response, except the one from the
 * broken page: that one returns a non-JSON completion body, so
 * `extractEvent` throws. Since Fix A, that failure is caught and logged by
 * `processInput` itself — it no longer propagates to `PipelineResult.errors`
 * or aborts any other source.
 */
function stubExtractFetch() {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as {
      messages: Array<{ content: string }>;
    };
    const userText = body.messages[1]!.content;
    if (userText.startsWith('Broken Page')) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'not valid json' } }] }),
        { status: 200 },
      );
    }
    if (userText.startsWith('No Url Workshop')) {
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(extractedFor('No Url Workshop', null)) } },
          ],
        }),
        { status: 200 },
      );
    }
    const title = userText.split('\n')[0]!.slice(0, 60);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(extractedFor(title)) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
}

function tmpStatePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-pipeline-'));
  return {
    path: join(dir, 'state.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function tmpSourcesFile(yaml: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-pipeline-src-'));
  const path = join(dir, 'sources.yaml');
  writeFileSync(path, yaml);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('runPipeline', () => {
  it('produces validated candidates for every non-LLM and LLM-backed source, drops an ical candidate that fails schema validation, and logs one source-item extraction failure without recording it as an error', async () => {
    const { path: statePath, cleanup } = tmpStatePath();
    const logs: string[] = [];
    try {
      const options: PipelineOptions = {
        sourcesPath: 'tests/discovery/fixtures/sources/pipeline-sources.yaml',
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 50,
        maxTokens: 500_000,
        today: '2026-09-23',
        fetchImpl: stubPageFetch(),
        sleepImpl: async () => {},
        extract: { apiKey: 'sk-test', model: 'test-extract-model', fetchImpl: stubExtractFetch() },
        log: (message) => logs.push(message),
      };
      const result = await runPipeline(options);

      // The ical source (`parseICalFeed`, Task 7) produces a structurally
      // complete draft with no LLM call, by design. But that parser never
      // populates `topics` (a deliberate, already-tested Task 7 behavior —
      // see tests/discovery/parsers/ical.test.ts's
      // `expect(draft.topics).toEqual([])`), and schema/event.schema.json
      // requires `topics` to have at least one item. So this candidate is
      // correctly rejected by `validateEvent` and dropped — matching this
      // task's own design doc ("A draft that fails validateEvent is
      // discarded and logged with the reason"). It must never reach
      // `candidates`; only its drop is observable, via the log callback.
      const titles = result.candidates.map((c) => c.title).sort();
      expect(titles).toEqual(
        [
          'Event Page Workshop',
          'Listing Child Workshop',
          'RSS Feed Workshop',
          'Telegram Workshop Announcement',
          'No Url Workshop',
        ].sort(),
      );
      expect(result.candidates.some((c) => c.title === 'Online Workshop From Ical')).toBe(false);
      expect(
        logs.some((line) =>
          line.includes('dropped candidate from https://example.org/calendar.ics'),
        ),
      ).toBe(true);

      const pageCandidate = result.candidates.find((c) => c.title === 'Event Page Workshop')!;
      expect(pageCandidate.source_url).toBe('https://example.org/event');
      expect(pageCandidate.topics).toEqual(['molecular-dynamics']);

      const listingCandidate = result.candidates.find((c) => c.title === 'Listing Child Workshop')!;
      expect(listingCandidate.source_url).toBe('https://example.org/listing/child');

      // Fix E: rss and telegram-channel are exercised end-to-end.
      const rssCandidate = result.candidates.find((c) => c.title === 'RSS Feed Workshop')!;
      expect(rssCandidate.source_url).toBe('https://example.org/rss-workshop');

      const telegramCandidate = result.candidates.find(
        (c) => c.title === 'Telegram Workshop Announcement',
      )!;
      expect(telegramCandidate.source_url).toBe('https://t.me/samplechannel/1');

      // Fix D: a null extracted url falls back to the input's own source URL.
      const noUrlCandidate = result.candidates.find((c) => c.title === 'No Url Workshop')!;
      expect(noUrlCandidate.url).toBe('https://example.org/no-url');

      // Fix A: the broken page's extraction failure is caught and logged,
      // never recorded as a pipeline error.
      expect(result.errors).toHaveLength(0);
      expect(
        logs.some((line) => line.includes('extraction failed for https://broken.example/page')),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('stops fetching new pages once maxPages is reached', async () => {
    const { path: statePath, cleanup } = tmpStatePath();
    try {
      const options: PipelineOptions = {
        sourcesPath: 'tests/discovery/fixtures/sources/pipeline-sources.yaml',
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 1,
        maxTokens: 500_000,
        today: '2026-09-23',
        fetchImpl: stubPageFetch(),
        sleepImpl: async () => {},
        extract: { apiKey: 'sk-test', model: 'test-extract-model', fetchImpl: stubExtractFetch() },
      };
      const result = await runPipeline(options);
      expect(result.candidates.length).toBeLessThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it('recovers a single item extraction failure without losing sibling items, and retries the failed item on the next run (Fix A)', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      `- name: Two Item Feed\n  url: https://example.org/two-item-feed.xml\n  kind: rss\n`,
    );
    const feedUrl = 'https://example.org/two-item-feed.xml';
    const feedBody = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>First Item</title><link>https://example.org/first-item</link></item>
  <item><title>Second Item</title><link>https://example.org/second-item</link></item>
</channel></rss>`;

    const pageFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.org/robots.txt') return new Response('', { status: 200 });
      if (url === feedUrl) return new Response(feedBody, { status: 200 });
      throw new Error(`unstubbed url: ${url}`);
    }) as typeof fetch;

    let firstItemShouldFail = true;
    const extractFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        messages: Array<{ content: string }>;
      };
      const userText = body.messages[1]!.content;
      if (userText.startsWith('First Item') && firstItemShouldFail) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'not valid json' } }] }),
          { status: 200 },
        );
      }
      const title = userText.split('\n')[0]!;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(extractedFor(title)) } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const baseOptions = (log?: (message: string) => void): PipelineOptions => ({
      sourcesPath,
      statePath,
      userAgent: 'Test Agent (+https://example.org)',
      maxPages: 50,
      maxTokens: 500_000,
      today: '2026-09-23',
      fetchImpl: pageFetch,
      sleepImpl: async () => {},
      extract: { apiKey: 'sk-test', model: 'test-extract-model', fetchImpl: extractFetch },
      log,
    });

    try {
      const logs1: string[] = [];
      const result1 = await runPipeline(baseOptions((m) => logs1.push(m)));

      expect(result1.candidates.map((c) => c.title)).toEqual(['Second Item']);
      expect(result1.errors).toHaveLength(0);
      expect(
        logs1.some((l) => l.includes('extraction failed for https://example.org/first-item')),
      ).toBe(true);

      firstItemShouldFail = false;
      const result2 = await runPipeline(baseOptions());
      expect(result2.candidates.map((c) => c.title).sort()).toEqual(['First Item', 'Second Item']);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('truncates extraction input text to the 8000-character cap before calling the extraction endpoint (Fix F)', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const longPageUrl = 'https://example.org/long-page';
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      `- name: Long Page\n  url: ${longPageUrl}\n  kind: event-page\n`,
    );
    const longBody = `<html><body><h1>Long Page</h1><p>${'A'.repeat(9000)}</p></body></html>`;

    const pageFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.org/robots.txt') return new Response('', { status: 200 });
      if (url === longPageUrl) return new Response(longBody, { status: 200 });
      throw new Error(`unstubbed url: ${url}`);
    }) as typeof fetch;

    const calls: string[] = [];
    const extractFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        messages: Array<{ content: string }>;
      };
      calls.push(body.messages[1]!.content);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ found: false, event: null }) } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 50,
        maxTokens: 500_000,
        today: '2026-09-23',
        fetchImpl: pageFetch,
        sleepImpl: async () => {},
        extract: { apiKey: 'sk-test', model: 'test-extract-model', fetchImpl: extractFetch },
      });
      expect(result.errors).toHaveLength(0);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.length).toBe(8000);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('stops extracting once maxTokens is reached, and reports tokensUsed', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Event Page One\n  url: https://example.org/event\n  kind: event-page\n' +
        '- name: Event Page Two\n  url: https://example.org/event-2\n  kind: event-page\n',
    );
    try {
      let extractCalls = 0;
      const extractFetch: typeof fetch = async () => {
        extractCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify(extractedFor('Event Page Workshop')) } },
            ],
            usage: { total_tokens: 1000 },
          }),
          { status: 200 },
        );
      };
      const pageResponses: Record<string, { status: number; body: string }> = {
        'https://example.org/robots.txt': { status: 200, body: '' },
        'https://example.org/event': { status: 200, body: eventPageBody },
        'https://example.org/event-2': { status: 200, body: eventPageBody },
      };
      const pageFetch: typeof fetch = async (input) => {
        const stub = pageResponses[String(input)];
        if (!stub) throw new Error(`unstubbed: ${String(input)}`);
        return new Response(stub.body, { status: stub.status });
      };

      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 200,
        maxTokens: 1000,
        fetchImpl: pageFetch,
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: extractFetch },
      });

      expect(extractCalls).toBe(1);
      expect(result.tokensUsed).toBe(1000);
      expect(result.candidates).toHaveLength(1);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });
});
