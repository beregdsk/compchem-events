import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRACT_BASE_URL, extractEvent } from '../../src/lib/discovery/extract-client';

function stubFetch(status: number, body: unknown, statusText = 'OK') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, statusText });
  }) as typeof fetch;
  return { impl, calls };
}

function completionWith(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

const options = { apiKey: 'sk-test', model: 'test-extract-model', topics: ['molecular-dynamics'] };

describe('extractEvent', () => {
  it('POSTs a chat-completion request with the text as the user message only', async () => {
    const { impl, calls } = stubFetch(200, completionWith({ found: false, event: null }));
    await extractEvent('Some page text', { ...options, fetchImpl: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DEFAULT_EXTRACT_BASE_URL);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(calls[0]!.init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Some page text' });
    expect(body.messages[0]!.content).not.toContain('Some page text');
  });

  it('returns null when the model reports no event found', async () => {
    const { impl } = stubFetch(200, completionWith({ found: false, event: null }));
    const result = await extractEvent('irrelevant text', { ...options, fetchImpl: impl });
    expect(result).toBeNull();
  });

  it('normalizes a found event, dropping null location/organizer/venue', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          location: { city: 'Testville', country: 'DE', venue: null },
          url: 'https://example.org/md-school',
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    // toStrictEqual (unlike toEqual) treats a key present with value `undefined` as different
    // from an absent key — this is the exact contract synthesizeDraft (Task 5) depends on.
    expect(result).toStrictEqual({
      title: 'MD Summer School',
      type: 'school',
      start_date: '2027-07-01',
      end_date: '2027-07-05',
      format: 'in-person',
      location: { city: 'Testville', country: 'DE' },
      url: 'https://example.org/md-school',
      topics: ['molecular-dynamics'],
      description: 'A summer school on molecular dynamics.',
      confidence: 0.9,
    });
    expect('location' in (result as object)).toBe(true);
    expect(Object.hasOwn(result as object, 'organizer')).toBe(false);
    expect(Object.hasOwn(result as object, 'cost')).toBe(false);
  });

  it('normalizes a stated cost, and omits the key entirely when cost is null', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          location: null,
          url: 'https://example.org/md-school',
          organizer: null,
          cost: 'Free',
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    expect(result?.cost).toBe('Free');
  });

  it('accepts a null event.url without throwing (Fix D)', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'No Canonical Url Workshop',
          type: 'workshop',
          start_date: '2027-06-01',
          end_date: '2027-06-02',
          format: 'online',
          location: null,
          url: null,
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A workshop with no stated canonical URL.',
          confidence: 0.7,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    expect(result).not.toBeNull();
    expect(result!.url).toBeNull();
  });

  it('throws on a non-2xx response', async () => {
    const { impl } = stubFetch(401, { error: 'bad key' }, 'Unauthorized');
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(/401/);
  });

  it('throws when the response content is not valid JSON', async () => {
    const { impl } = stubFetch(200, { choices: [{ message: { content: 'not json' } }] });
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('throws when the found event does not match the expected shape', async () => {
    const { impl } = stubFetch(200, completionWith({ found: true, event: { title: 'X' } }));
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /expected shape/,
    );
  });

  it('reports token usage via onUsage', async () => {
    const usages: number[] = [];
    const { impl } = stubFetch(200, {
      ...completionWith({ found: false, event: null }),
      usage: { total_tokens: 321 },
    });
    await extractEvent('some text', {
      ...options,
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(usages).toEqual([321]);
  });

  it('reports 0 usage when the response has no usage field', async () => {
    const usages: number[] = [];
    const { impl } = stubFetch(200, completionWith({ found: false, event: null }));
    await extractEvent('some text', {
      ...options,
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(usages).toEqual([0]);
  });

  it('throws when a well-formed event carries a malformed nested location', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          // country is missing and venue is a number, not string | null — both invalid.
          location: { city: 'Testville', venue: 123 },
          url: 'https://example.org/md-school',
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /expected shape/,
    );
  });
});
