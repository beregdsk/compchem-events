import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../scripts/discovery/parse-sources';

const validEnv = {
  LLM_API_KEY: 'sk-test',
  LLM_MODEL_EXTRACT: 'test-extract-model',
  STATE_PATH: '/tmp/discovery-state.json',
};

describe('buildConfig', () => {
  it('builds a config from a complete environment', () => {
    const result = buildConfig(validEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.statePath).toBe('/tmp/discovery-state.json');
    expect(result.config.maxPages).toBe(200);
    expect(result.config.extract.apiKey).toBe('sk-test');
    expect(result.config.extract.model).toBe('test-extract-model');
    expect(result.config.userAgent).toContain('Discovery Agent');
  });

  it('fails fast when LLM_API_KEY is missing', () => {
    const { LLM_API_KEY: _drop, ...rest } = validEnv;
    void _drop;
    const result = buildConfig(rest);
    expect(result).toEqual({ ok: false, error: 'LLM_API_KEY is required' });
  });

  it('fails fast when LLM_MODEL_EXTRACT is missing', () => {
    const { LLM_MODEL_EXTRACT: _drop, ...rest } = validEnv;
    void _drop;
    const result = buildConfig(rest);
    expect(result).toEqual({ ok: false, error: 'LLM_MODEL_EXTRACT is required' });
  });

  it('fails fast when STATE_PATH is missing', () => {
    const { STATE_PATH: _drop, ...rest } = validEnv;
    void _drop;
    const result = buildConfig(rest);
    expect(result).toEqual({ ok: false, error: 'STATE_PATH is required' });
  });

  it('rejects a non-numeric MAX_PAGES', () => {
    const result = buildConfig({ ...validEnv, MAX_PAGES: 'lots' });
    expect(result).toEqual({ ok: false, error: 'MAX_PAGES must be a positive number, got "lots"' });
  });

  it('honours a custom MAX_PAGES and LLM_BASE_URL', () => {
    const result = buildConfig({
      ...validEnv,
      MAX_PAGES: '10',
      LLM_BASE_URL: 'https://proxy.example/chat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.maxPages).toBe(10);
    expect(result.config.extract.baseUrl).toBe('https://proxy.example/chat');
  });

  it('defaults MAX_TOKENS to 500000', () => {
    const result = buildConfig(validEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.maxTokens).toBe(500_000);
  });

  it('rejects a non-numeric MAX_TOKENS', () => {
    const result = buildConfig({ ...validEnv, MAX_TOKENS: 'lots' });
    expect(result).toEqual({ ok: false, error: 'MAX_TOKENS must be a positive number, got "lots"' });
  });
});
