import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../scripts/discovery/run';

const validEnv = {
  LLM_API_KEY: 'sk-test',
  LLM_MODEL_EXTRACT: 'test-extract-model',
  STATE_PATH: '/tmp/discovery-state.json',
  GITHUB_TOKEN: 'gh-test-token',
  GITHUB_REPO: 'acme/compchem-events',
};

describe('buildConfig', () => {
  it('builds a config from a complete environment, with defaults', () => {
    const result = buildConfig(validEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.maxPages).toBe(200);
    expect(result.config.maxTokens).toBe(500_000);
    expect(result.config.maxPrs).toBe(20);
    expect(result.config.github).toEqual({ token: 'gh-test-token', repo: 'acme/compchem-events' });
    expect(result.config.extract.apiKey).toBe('sk-test');
    expect(result.config.classify.apiKey).toBe('sk-test');
  });

  it('fails fast when GITHUB_TOKEN is missing', () => {
    const { GITHUB_TOKEN: _drop, ...rest } = validEnv;
    void _drop;
    expect(buildConfig(rest)).toEqual({ ok: false, error: 'GITHUB_TOKEN is required' });
  });

  it('fails fast when GITHUB_REPO is missing', () => {
    const { GITHUB_REPO: _drop, ...rest } = validEnv;
    void _drop;
    expect(buildConfig(rest)).toEqual({
      ok: false,
      error: 'GITHUB_REPO must be in the form "owner/repo", got "undefined"',
    });
  });

  it('rejects a malformed GITHUB_REPO', () => {
    expect(buildConfig({ ...validEnv, GITHUB_REPO: 'not-owner-slash-repo' })).toEqual({
      ok: false,
      error: 'GITHUB_REPO must be in the form "owner/repo", got "not-owner-slash-repo"',
    });
  });

  it('rejects a non-numeric MAX_TOKENS', () => {
    expect(buildConfig({ ...validEnv, MAX_TOKENS: 'lots' })).toEqual({
      ok: false,
      error: 'MAX_TOKENS must be a positive number, got "lots"',
    });
  });

  it('rejects a non-positive MAX_PRS', () => {
    expect(buildConfig({ ...validEnv, MAX_PRS: '0' })).toEqual({
      ok: false,
      error: 'MAX_PRS must be a positive number, got "0"',
    });
  });
});
