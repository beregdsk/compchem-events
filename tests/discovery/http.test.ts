import { describe, expect, it } from 'vitest';
import { fetchWithTimeout } from '../../src/lib/discovery/http';

describe('fetchWithTimeout', () => {
  it('passes an unaborted AbortSignal to fetchImpl', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok');
    }) as typeof fetch;

    await fetchWithTimeout(fetchImpl, 'https://example.org', {}, 1000);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('aborts the signal once timeoutMs elapses', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok');
    }) as typeof fetch;

    await fetchWithTimeout(fetchImpl, 'https://example.org', {}, 10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('preserves the caller-supplied method, headers and body', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (_url, init) => {
      capturedInit = init;
      return new Response('ok');
    }) as typeof fetch;

    await fetchWithTimeout(
      fetchImpl,
      'https://example.org',
      { method: 'POST', headers: { 'X-Test': '1' }, body: 'payload' },
      1000,
    );
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toEqual({ 'X-Test': '1' });
    expect(capturedInit?.body).toBe('payload');
  });

  it('rejects when a stalled fetchImpl is aborted by the timeout, same as a real hung connection', async () => {
    const fetchImpl = (async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'TimeoutError'));
        });
      });
    }) as typeof fetch;

    await expect(fetchWithTimeout(fetchImpl, 'https://example.org', {}, 10)).rejects.toThrow();
  });

  it('defaults to DEFAULT_FETCH_TIMEOUT_MS when no timeoutMs is given', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = (async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok');
    }) as typeof fetch;

    await fetchWithTimeout(fetchImpl, 'https://example.org');
    expect(capturedSignal?.aborted).toBe(false);
  });
});
