import { describe, expect, it } from 'vitest';
import {
  callJev,
  DEFAULT_JEV_BASE_URL,
  type DecisionsRequest,
} from '../../src/lib/discovery/jev-client';

function stubFetch(status: number, body: unknown, statusText = 'OK') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, statusText });
  }) as typeof fetch;
  return { impl, calls };
}

const request: DecisionsRequest = {
  model: 'test-model',
  state: { title: 'X' },
  questions: {
    add: { type: 'noul', instructions: 'i', criteria: { true: 't', false: 'f' } },
  },
};

describe('callJev', () => {
  it('POSTs the request with bearer auth and a JSON body', async () => {
    const { impl, calls } = stubFetch(200, {
      model: 'x',
      answers: { add: { type: 'noul', noul: 0.7 } },
      usage: { input_tokens: 1, output_tokens: 0, cost: 0 },
    });
    await callJev(request, { apiKey: 'sk-test', fetchImpl: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DEFAULT_JEV_BASE_URL);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(request);
  });

  it('returns the parsed response on success', async () => {
    const payload = {
      model: 'x',
      answers: { add: { type: 'noul', noul: 0.42 } },
      usage: { input_tokens: 1, output_tokens: 0, cost: 0.00001 },
    };
    const { impl } = stubFetch(200, payload);
    const result = await callJev(request, { apiKey: 'sk-test', fetchImpl: impl });
    expect(result).toEqual(payload);
  });

  it('throws with the status on a non-2xx response', async () => {
    const { impl } = stubFetch(401, { error: 'bad key' }, 'Unauthorized');
    await expect(callJev(request, { apiKey: 'bad', fetchImpl: impl })).rejects.toThrow(/401/);
  });

  it('throws when the response has no answers', async () => {
    const { impl } = stubFetch(200, { model: 'x' });
    await expect(callJev(request, { apiKey: 'sk-test', fetchImpl: impl })).rejects.toThrow(
      /answers/,
    );
  });

  it('uses a custom baseUrl when given', async () => {
    const { impl, calls } = stubFetch(200, {
      model: 'x',
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
    });
    await callJev(request, {
      apiKey: 'sk-test',
      fetchImpl: impl,
      baseUrl: 'https://proxy.example/decisions',
    });
    expect(calls[0]!.url).toBe('https://proxy.example/decisions');
  });
});
