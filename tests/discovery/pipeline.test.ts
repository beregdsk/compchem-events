import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MailboxCredentials, ParsedMailMessage } from '../../src/lib/discovery/mailbox-client';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';
import { loadState } from '../../src/lib/discovery/state';

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
BEGIN:VEVENT
UID:ical-2@example.org
DTSTART;VALUE=DATE:20270401
DTEND;VALUE=DATE:20270403
SUMMARY:Molecular Dynamics Winter School
URL:https://example.org/md-school
END:VEVENT
BEGIN:VEVENT
UID:ical-3@example.org
DTSTART;VALUE=DATE:20270501
DTEND;VALUE=DATE:20270503
SUMMARY:OpenMolcas Developers Meeting
DESCRIPTION:A quantum chemistry code meeting.
URL:https://example.org/openmolcas
END:VEVENT
BEGIN:VEVENT
UID:ical-4@example.org
DTSTART;VALUE=DATE:20270601
DTEND;VALUE=DATE:20270603
SUMMARY:Enhanced Sampling Workshop
LOCATION:Institut Henri Poincaré, Paris, France
URL:https://example.org/sampling
END:VEVENT
END:VCALENDAR`;

// All extraction-bound bodies below mention "chemistry" so they clear the
// relevance pre-filter and still exercise the extraction path they're
// meant to test — see the dedicated off-topic test for the filter itself.
const eventPageBody =
  '<html><body><h1>Event Page Workshop</h1>\n<p>A computational chemistry event in Testville.</p></body></html>';
const listingBody = '<html><body><a href="/listing/child">Child Event</a></body></html>';
const listingChildBody =
  '<html><body><h1>Listing Child Workshop</h1>\n<p>A computational chemistry event.</p></body></html>';
const brokenPageBody =
  '<html><body><h1>Broken Page</h1><p>A computational chemistry event.</p></body></html>';
const noUrlPageBody =
  '<html><body><h1>No Url Workshop</h1>\n<p>A computational chemistry event.</p></body></html>';

// The description is deliberately HTML markup (Fix B): the pipeline test
// only needs to prove the run completes and produces a candidate — the
// plain-text conversion itself is covered in detail by
// tests/discovery/parsers/rss.test.ts.
const rssBody = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>RSS Feed Workshop</title>
    <description>&lt;p&gt;A computational chemistry event in Testville.&lt;/p&gt;</description>
    <link>https://example.org/rss-workshop</link>
  </item>
</channel></rss>`;

const telegramBody = `
  <div class="tgme_widget_message" data-post="samplechannel/1">
    <div class="tgme_widget_message_text">Telegram Computational Chemistry Workshop Announcement</div>
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
      cost: null,
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
function stubExtractFetch(seenTexts: string[] = []) {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as {
      messages: Array<{ content: string }>;
    };
    const userText = body.messages[1]!.content;
    seenTexts.push(userText);
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
  it('produces validated candidates for every non-LLM and LLM-backed source, and logs one source-item extraction failure without recording it as an error', async () => {
    const { path: statePath, cleanup } = tmpStatePath();
    const logs: string[] = [];
    const extractTexts: string[] = [];
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
        extract: {
          apiKey: 'sk-test',
          model: 'test-extract-model',
          fetchImpl: stubExtractFetch(extractTexts),
        },
        log: (message) => logs.push(message),
      };
      const result = await runPipeline(options);

      // Ical events carry no topics: one gets them from keywords with no
      // LLM call, one keywords can't place goes to the model, and one that
      // is neither on-topic nor placeable is skipped by the relevance filter.
      const titles = result.candidates.map((c) => c.title).sort();
      expect(titles).toEqual(
        [
          'Event Page Workshop',
          'Listing Child Workshop',
          'RSS Feed Workshop',
          'Telegram Computational Chemistry Workshop Announcement',
          'No Url Workshop',
          'Molecular Dynamics Winter School',
          'OpenMolcas Developers Meeting',
          'Enhanced Sampling Workshop',
        ].sort(),
      );
      const mdSchool = result.candidates.find(
        (c) => c.title === 'Molecular Dynamics Winter School',
      )!;
      expect(mdSchool.topics).toEqual(['molecular-dynamics']);
      expect(mdSchool.url).toBe('https://example.org/md-school');
      expect(mdSchool.source_url).toBe('https://example.org/calendar.ics');
      // Keywords place this one, but an in-person event needs a structured
      // location the feed doesn't have, so it goes to the model — with the
      // feed's free-text location, and the model's topics win.
      const sampling = result.candidates.find((c) => c.title === 'Enhanced Sampling Workshop')!;
      expect(sampling.topics).toEqual(['molecular-dynamics']);
      expect(
        extractTexts.some((t) => t.includes('Location: Institut Henri Poincaré, Paris, France')),
      ).toBe(true);
      const molcas = result.candidates.find((c) => c.title === 'OpenMolcas Developers Meeting')!;
      expect(molcas.source_url).toBe('https://example.org/calendar.ics');
      expect(
        logs.some((line) => line === 'skipping (off-topic): https://example.org/calendar.ics'),
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
        (c) => c.title === 'Telegram Computational Chemistry Workshop Announcement',
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
      // Only the first source's one page was fetched — the ical feed, which
      // alone may yield several candidates.
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(
        result.candidates.every((c) => c.source_url === 'https://example.org/calendar.ics'),
      ).toBe(true);
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
  <item><title>First Item</title><description>A computational chemistry event.</description><link>https://example.org/first-item</link></item>
  <item><title>Second Item</title><description>A computational chemistry event.</description><link>https://example.org/second-item</link></item>
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
    const longBody = `<html><body><h1>Long Page on Computational Chemistry</h1><p>${'A'.repeat(9000)}</p></body></html>`;

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

  // Within one source items are extracted in turn, so the cap is exact
  // there; across concurrently running sources a call already in flight
  // still completes, so a run can overshoot by a few calls.
  it('stops extracting once maxTokens is reached, and reports tokensUsed', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Two Item Feed\n  url: https://example.org/two-items.xml\n  kind: rss\n',
    );
    const twoItemFeed = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>First Item</title><description>A computational chemistry event.</description><link>https://example.org/first</link></item>
  <item><title>Second Item</title><description>A computational chemistry event.</description><link>https://example.org/second</link></item>
</channel></rss>`;
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
        'https://example.org/two-items.xml': { status: 200, body: twoItemFeed },
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
      // The second item was fetched but never extracted (budget exhausted).
      // The feed's page state must not be committed, or a future run would
      // see it as "unchanged" and skip it forever, silently losing the event.
      const state = loadState(statePath);
      expect(state.pages['https://example.org/two-items.xml']).toBeUndefined();
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('extracts every event an inline listing states, and each CECAM API event with its page text', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Inline\n  url: https://example.org/upcoming\n  kind: inline-listing\n' +
        '- name: CECAM\n  url: https://www.cecam.org/program\n  kind: cecam-api\n',
    );
    try {
      const pageFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
        if (url === 'https://example.org/upcoming') {
          return new Response(
            '<html><body><p>Upcoming computational chemistry events: Alpha Workshop, 1 Mar 2027; Beta School, 5 Apr 2027.</p></body></html>',
          );
        }
        if (url === 'https://members.cecam.org/api/all-events') {
          expect(init?.method).toBe('POST');
          return new Response(
            JSON.stringify({
              success: '1',
              workshops: {
                last_page: 1,
                data: [
                  {
                    title: 'Gamma Workshop',
                    slug: 'gamma-workshop-1500',
                    start: '2027-06-01',
                    end: '2027-06-03',
                    event: 'Flagship Workshop',
                    location: 'CECAM-HQ-EPFL, Lausanne, Switzerland',
                    organisers: [],
                  },
                ],
              },
            }),
          );
        }
        if (url === 'https://www.cecam.org/workshop-details/gamma-workshop-1500') {
          return new Response(
            '<html><body><p>A workshop on molecular simulation in chemistry.</p></body></html>',
          );
        }
        throw new Error(`unstubbed: ${url}`);
      };
      const extractTexts: string[] = [];
      const extractFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as {
          messages: Array<{ content: string }>;
          response_format: { json_schema: { name: string } };
        };
        const text = body.messages[1]!.content;
        extractTexts.push(text);
        const content =
          body.response_format.json_schema.name === 'candidate_events'
            ? {
                events: [
                  extractedFor('Alpha Workshop').event,
                  extractedFor('Beta School').event,
                  {
                    ...extractedFor('Omega Workshop').event,
                    start_date: '2025-01-10',
                    end_date: '2025-01-12',
                  },
                ],
              }
            : extractedFor(text.split('\n')[0]!);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        );
      }) as typeof fetch;

      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 50,
        maxTokens: 500_000,
        sleepImpl: async () => {},
        fetchImpl: pageFetch,
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: extractFetch },
      });

      expect(result.errors).toEqual([]);
      // Omega ended before `today`: extracted, but never a candidate.
      expect(result.candidates.map((c) => c.title).sort()).toEqual([
        'Alpha Workshop',
        'Beta School',
        'Gamma Workshop',
      ]);
      const alpha = result.candidates.find((c) => c.title === 'Alpha Workshop')!;
      expect(alpha.source_url).toBe('https://example.org/upcoming');
      const gamma = result.candidates.find((c) => c.title === 'Gamma Workshop')!;
      expect(gamma.source_url).toBe('https://www.cecam.org/workshop-details/gamma-workshop-1500');
      const gammaText = extractTexts.find((t) => t.startsWith('Gamma Workshop'))!;
      expect(gammaText).toContain('Dates: 2027-06-01 to 2027-06-03');
      expect(gammaText).toContain('A workshop on molecular simulation in chemistry.');
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('sends Russian- and Chinese-language posts to the model instead of skipping them as off-topic', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Channel\n  url: https://t.me/s/confsci\n  kind: telegram-channel\n',
    );
    const logs: string[] = [];
    try {
      const pageFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
        return new Response(`
          <div class="tgme_widget_message" data-post="confsci/1">
            <div class="tgme_widget_message_text">Школа по квантовой химии<br>Дата: 1–3 марта 2027 г.</div>
          </div>
          <div class="tgme_widget_message" data-post="confsci/2">
            <div class="tgme_widget_message_text">Конференция по механике грунтов</div>
          </div>
          <div class="tgme_widget_message" data-post="confsci/3">
            <div class="tgme_widget_message_text">第十六届全国理论与计算化学会议<br>2027年5月</div>
          </div>`);
      };
      const extractTexts: string[] = [];
      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 50,
        maxTokens: 500_000,
        sleepImpl: async () => {},
        fetchImpl: pageFetch,
        extract: {
          apiKey: 'sk-test',
          model: 'test-model',
          fetchImpl: stubExtractFetch(extractTexts),
        },
        log: (m) => logs.push(m),
      });
      expect(extractTexts).toHaveLength(2);
      expect(extractTexts[0]).toContain('квантовой химии');
      expect(extractTexts[1]).toContain('理论与计算化学');
      expect(logs).toContain('skipping (off-topic): https://t.me/confsci/2');
      expect(logs.filter((l) => l.startsWith('dropped'))).toEqual([]);
      expect(result.candidates).toHaveLength(2);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('follows a listing through its rel="next" pages, at most five deep', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Paged\n  url: https://example.org/events/\n  kind: listing-page\n',
    );
    try {
      const fetched: string[] = [];
      const pageFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
        fetched.push(url);
        const listing = /\/events\/(?:page\/(\d+)\/)?$/.exec(url);
        if (listing) {
          const n = Number(listing[1] ?? 1);
          return new Response(
            `<main><a href="/events/post-${n}/">Post ${n}</a>` +
              `<a rel="next" href="/events/page/${n + 1}/">Next</a></main>`,
          );
        }
        return new Response(
          `<html><body><h1>${url.slice(-7, -1)} Workshop</h1><p>A computational chemistry event.</p></body></html>`,
        );
      };
      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 100,
        maxTokens: 500_000,
        sleepImpl: async () => {},
        fetchImpl: pageFetch,
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: stubExtractFetch() },
      });
      const listingPages = fetched.filter((u) => /\/events\/(page\/\d+\/)?$/.test(u));
      expect(listingPages).toEqual([
        'https://example.org/events/',
        'https://example.org/events/page/2/',
        'https://example.org/events/page/3/',
        'https://example.org/events/page/4/',
        'https://example.org/events/page/5/',
      ]);
      expect(result.candidates).toHaveLength(5);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  it('runs sources concurrently without overshooting maxPages', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const hosts = ['a', 'b', 'c', 'd', 'e'].map((h) => `${h}.example`);
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      hosts.map((h) => `- name: ${h}\n  url: https://${h}/event\n  kind: event-page\n`).join(''),
    );
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      const pagesFetched: string[] = [];
      const pageFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
        pagesFetched.push(url);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return new Response(eventPageBody, { status: 200 });
      };
      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 3,
        maxTokens: 500_000,
        sleepImpl: async () => {},
        fetchImpl: pageFetch,
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: stubExtractFetch() },
      });
      expect(maxInFlight).toBeGreaterThan(1);
      expect(pagesFetched).toHaveLength(3);
      expect(result.candidates).toHaveLength(3);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  // A single prolific listing-page source must not be able to consume the
  // entire shared page budget — GRC's find-a-conference page discovered
  // hundreds of unrelated-discipline links in one run, starving every
  // source listed after it. maxPagesPerSource caps that per source, and
  // each source gets a fresh budget rather than sharing one running total.
  it('caps pages fetched from a single prolific source, leaving budget for the rest', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Prolific Listing\n  url: https://prolific.example/listing\n  kind: listing-page\n' +
        '- name: Other Source\n  url: https://other.example/single\n  kind: event-page\n',
    );
    try {
      const fetchedUrls: string[] = [];
      const listingBody = [1, 2, 3, 4, 5]
        .map((n) => `<a href="https://prolific.example/event-${n}">Event ${n}</a>`)
        .join('\n');
      const pageResponses: Record<string, { status: number; body: string }> = {
        'https://prolific.example/robots.txt': { status: 200, body: '' },
        'https://other.example/robots.txt': { status: 200, body: '' },
        'https://prolific.example/listing': { status: 200, body: listingBody },
        'https://other.example/single': { status: 200, body: eventPageBody },
      };
      for (const n of [1, 2, 3, 4, 5]) {
        pageResponses[`https://prolific.example/event-${n}`] = { status: 200, body: eventPageBody };
      }
      const pageFetch: typeof fetch = async (input) => {
        const url = String(input);
        fetchedUrls.push(url);
        const stub = pageResponses[url];
        if (!stub) throw new Error(`unstubbed: ${url}`);
        return new Response(stub.body, { status: stub.status });
      };
      const extractFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(extractedFor('Event')) } }],
          }),
          { status: 200 },
        );

      await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 200,
        maxTokens: 500_000,
        maxPagesPerSource: 2,
        fetchImpl: pageFetch,
        sleepImpl: async () => {},
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: extractFetch },
      });

      const prolificFetches = fetchedUrls.filter(
        (u) =>
          u.startsWith('https://prolific.example/') && u !== 'https://prolific.example/robots.txt',
      );
      const otherFetches = fetchedUrls.filter(
        (u) => u.startsWith('https://other.example/') && u !== 'https://other.example/robots.txt',
      );
      expect(prolificFetches).toHaveLength(2);
      expect(otherFetches).toHaveLength(1);
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  // GRC's find-a-conference page pulls in event pages for every discipline
  // it covers, not just chemistry — most of that text never mentions
  // chemistry, computation or any topic in data/topics.yaml at all, so a
  // cheap local keyword check can reject it before spending a token.
  it('skips extraction for a page that matches no relevance keyword, without spending a token', async () => {
    const { path: statePath, cleanup: cleanupState } = tmpStatePath();
    const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
      '- name: Off Topic\n  url: https://example.org/off-topic\n  kind: event-page\n',
    );
    try {
      let extractCalls = 0;
      const offTopicBody =
        '<html><body><h1>Antibody Biology and Engineering Conference</h1>' +
        '<p>A meeting on immunology, antibody structure and therapeutic engineering.</p></body></html>';
      const pageFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url === 'https://example.org/robots.txt') return new Response('', { status: 200 });
        if (url === 'https://example.org/off-topic')
          return new Response(offTopicBody, { status: 200 });
        throw new Error(`unstubbed: ${url}`);
      };
      const extractFetch: typeof fetch = async () => {
        extractCalls += 1;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(extractedFor('Event')) } }],
          }),
          { status: 200 },
        );
      };

      const result = await runPipeline({
        sourcesPath,
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 200,
        maxTokens: 500_000,
        fetchImpl: pageFetch,
        extract: { apiKey: 'sk-test', model: 'test-model', fetchImpl: extractFetch },
      });

      expect(extractCalls).toBe(0);
      expect(result.candidates).toHaveLength(0);
      // A genuine "nothing relevant here" outcome, same as "no event
      // found" — the page state must still commit so an unchanged page
      // isn't re-fetched and re-checked every single run.
      const state = loadState(statePath);
      expect(state.pages['https://example.org/off-topic']).toBeDefined();
    } finally {
      cleanupState();
      cleanupSources();
    }
  });

  // The mailbox source kind has no real IMAP connection in tests — a fake
  // `mailboxFetchImpl` stands in for `fetchNewMailboxMessages`, filtering by
  // `alreadySeen` itself exactly as the real one is documented to (only new
  // Message-IDs come back), so these tests exercise the pipeline's own
  // per-message dedup/rollback wiring (`state.pages['mailbox:...']`), not
  // the IMAP client.
  describe('mailbox source', () => {
    const dummyCredentials: MailboxCredentials = {
      host: 'imap.example.org',
      user: 'discovery@example.org',
      password: 'unused-in-tests',
    };
    const allMessages: ParsedMailMessage[] = [
      {
        messageId: '<msg-a@list.example>',
        text: 'First Chemistry Announcement\n\nA computational chemistry event.',
      },
      {
        messageId: '<msg-b@list.example>',
        text: 'Second Chemistry Announcement\n\nA computational chemistry event.',
      },
    ];

    function fakeMailboxFetchImpl(
      messages: ParsedMailMessage[],
    ): (
      credentials: MailboxCredentials,
      folder: string,
      alreadySeen: (messageId: string) => boolean,
    ) => Promise<ParsedMailMessage[]> {
      return async (_credentials, _folder, alreadySeen) =>
        messages.filter((m) => !alreadySeen(m.messageId));
    }

    it("produces a candidate from a new message, using the source's own url as source_url, and does not reprocess it on a later run", async () => {
      const { path: statePath, cleanup: cleanupState } = tmpStatePath();
      const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
        '- name: Psi-k\n  url: https://psi-k.example/mailing-list\n  kind: mailbox\n  folder: Psi-k\n',
      );
      try {
        const baseOptions = (): PipelineOptions => ({
          sourcesPath,
          statePath,
          userAgent: 'Test Agent (+https://example.org)',
          maxPages: 50,
          maxTokens: 500_000,
          today: '2026-09-23',
          sleepImpl: async () => {},
          extract: {
            apiKey: 'sk-test',
            model: 'test-extract-model',
            fetchImpl: stubExtractFetch(),
          },
          mailbox: dummyCredentials,
          mailboxFetchImpl: fakeMailboxFetchImpl(allMessages),
        });

        const result1 = await runPipeline(baseOptions());
        expect(result1.candidates.map((c) => c.title).sort()).toEqual([
          'First Chemistry Announcement',
          'Second Chemistry Announcement',
        ]);
        for (const candidate of result1.candidates) {
          expect(candidate.source_url).toBe('https://psi-k.example/mailing-list');
        }
        const state = loadState(statePath);
        expect(state.pages['mailbox:Psi-k:<msg-a@list.example>']).toBeDefined();
        expect(state.pages['mailbox:Psi-k:<msg-b@list.example>']).toBeDefined();

        // Same two messages come back from the fake every time (it doesn't
        // remember what it returned before) — only the pipeline's own
        // `state.pages` dedup, exercised through `alreadySeen`, is what
        // must stop them reappearing as candidates.
        const result2 = await runPipeline(baseOptions());
        expect(result2.candidates).toHaveLength(0);
      } finally {
        cleanupState();
        cleanupSources();
      }
    });

    it('rolls back a message whose extraction fails, retrying it (and only it) on the next run', async () => {
      const { path: statePath, cleanup: cleanupState } = tmpStatePath();
      const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
        '- name: Psi-k\n  url: https://psi-k.example/mailing-list\n  kind: mailbox\n',
      );
      try {
        let firstMessageShouldFail = true;
        const extractFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse((init?.body as string) ?? '{}') as {
            messages: Array<{ content: string }>;
          };
          const userText = body.messages[1]!.content;
          if (userText.startsWith('First Chemistry Announcement') && firstMessageShouldFail) {
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

        const baseOptions = (): PipelineOptions => ({
          sourcesPath,
          statePath,
          userAgent: 'Test Agent (+https://example.org)',
          maxPages: 50,
          maxTokens: 500_000,
          today: '2026-09-23',
          sleepImpl: async () => {},
          extract: { apiKey: 'sk-test', model: 'test-extract-model', fetchImpl: extractFetch },
          mailbox: dummyCredentials,
          mailboxFetchImpl: fakeMailboxFetchImpl(allMessages),
        });

        const result1 = await runPipeline(baseOptions());
        expect(result1.candidates.map((c) => c.title)).toEqual(['Second Chemistry Announcement']);
        expect(result1.errors).toHaveLength(0);

        firstMessageShouldFail = false;
        const result2 = await runPipeline(baseOptions());
        // Only the previously-failed message is retried — the accepted one
        // stays durably seen and is not reprocessed.
        expect(result2.candidates.map((c) => c.title)).toEqual(['First Chemistry Announcement']);
      } finally {
        cleanupState();
        cleanupSources();
      }
    });

    it('requeues a candidate a later step deferred, retrying its message (and only it) on the next run', async () => {
      const { path: statePath, cleanup: cleanupState } = tmpStatePath();
      const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
        '- name: Psi-k\n  url: https://psi-k.example/mailing-list\n  kind: mailbox\n',
      );
      try {
        const baseOptions = (): PipelineOptions => ({
          sourcesPath,
          statePath,
          userAgent: 'Test Agent (+https://example.org)',
          maxPages: 50,
          maxTokens: 500_000,
          today: '2026-09-23',
          sleepImpl: async () => {},
          extract: {
            apiKey: 'sk-test',
            model: 'test-extract-model',
            fetchImpl: stubExtractFetch(),
          },
          mailbox: dummyCredentials,
          mailboxFetchImpl: fakeMailboxFetchImpl(allMessages),
        });

        const result1 = await runPipeline(baseOptions());
        const first = result1.candidates.find((c) => c.title === 'First Chemistry Announcement')!;
        // As if the orchestrator hit MAX_TOKENS before classifying `first`.
        result1.requeue([first.id]);
        expect(
          loadState(statePath).pages['mailbox:discovery:<msg-a@list.example>'],
        ).toBeUndefined();

        const result2 = await runPipeline(baseOptions());
        expect(result2.candidates.map((c) => c.title)).toEqual(['First Chemistry Announcement']);
      } finally {
        cleanupState();
        cleanupSources();
      }
    });

    it('skips mailbox sources without recording an error when no IMAP credentials are configured', async () => {
      const { path: statePath, cleanup: cleanupState } = tmpStatePath();
      const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
        '- name: Psi-k\n  url: https://psi-k.example/mailing-list\n  kind: mailbox\n',
      );
      const logs: string[] = [];
      try {
        const result = await runPipeline({
          sourcesPath,
          statePath,
          userAgent: 'Test Agent (+https://example.org)',
          maxPages: 50,
          maxTokens: 500_000,
          extract: {
            apiKey: 'sk-test',
            model: 'test-extract-model',
            fetchImpl: stubExtractFetch(),
          },
          log: (message) => logs.push(message),
        });
        expect(result.candidates).toHaveLength(0);
        expect(result.errors).toHaveLength(0);
        expect(logs.some((l) => l.includes('no IMAP credentials configured'))).toBe(true);
      } finally {
        cleanupState();
        cleanupSources();
      }
    });

    it('records a source error, without throwing, when the mailbox connection itself fails', async () => {
      const { path: statePath, cleanup: cleanupState } = tmpStatePath();
      const { path: sourcesPath, cleanup: cleanupSources } = tmpSourcesFile(
        '- name: Psi-k\n  url: https://psi-k.example/mailing-list\n  kind: mailbox\n',
      );
      try {
        const result = await runPipeline({
          sourcesPath,
          statePath,
          userAgent: 'Test Agent (+https://example.org)',
          maxPages: 50,
          maxTokens: 500_000,
          extract: {
            apiKey: 'sk-test',
            model: 'test-extract-model',
            fetchImpl: stubExtractFetch(),
          },
          mailbox: dummyCredentials,
          mailboxFetchImpl: async () => {
            throw new Error('ECONNREFUSED');
          },
        });
        expect(result.candidates).toHaveLength(0);
        expect(result.errors).toEqual([
          { source: 'https://psi-k.example/mailing-list', message: 'ECONNREFUSED' },
        ]);
      } finally {
        cleanupState();
        cleanupSources();
      }
    });
  });
});
