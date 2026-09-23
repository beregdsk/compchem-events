import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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

function extractedFor(title: string) {
  return {
    found: true,
    event: {
      title,
      type: 'workshop',
      start_date: '2027-05-01',
      end_date: '2027-05-03',
      format: 'online',
      location: null,
      url: 'https://example.org/extracted-event',
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
 * `extractEvent` throws and the pipeline's per-source error isolation
 * (not the fetch layer's) is what's under test.
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

describe('runPipeline', () => {
  it('produces validated candidates for every non-LLM and LLM-backed source, drops an ical candidate that fails schema validation, and isolates one source failing', async () => {
    const { path: statePath, cleanup } = tmpStatePath();
    const logs: string[] = [];
    try {
      const options: PipelineOptions = {
        sourcesPath: 'tests/discovery/fixtures/sources/pipeline-sources.yaml',
        statePath,
        userAgent: 'Test Agent (+https://example.org)',
        maxPages: 50,
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
      expect(titles).toEqual(['Event Page Workshop', 'Listing Child Workshop'].sort());
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

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.source).toBe('https://broken.example/page');
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
});
