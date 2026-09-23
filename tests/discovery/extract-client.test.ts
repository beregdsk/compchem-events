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
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    expect(result).toEqual({
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
});
