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
    // No IMAP_* vars: mailbox stays undefined, exactly like a deployment
    // that has no dedicated mailing-list account yet — see
    // docs/discovery-agent.md, "Mailing lists".
    expect(result.config.mailbox).toBeUndefined();
  });

  it('builds mailbox credentials when all three IMAP vars are set, with port/secure defaults', () => {
    const result = buildConfig({
      ...validEnv,
      IMAP_HOST: 'imap.example.org',
      IMAP_USER: 'discovery@example.org',
      IMAP_PASSWORD: 'app-password',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.mailbox).toEqual({
      host: 'imap.example.org',
      port: 993,
      secure: true,
      user: 'discovery@example.org',
      password: 'app-password',
    });
  });

  it('honours IMAP_PORT and IMAP_SECURE overrides', () => {
    const result = buildConfig({
      ...validEnv,
      IMAP_HOST: 'imap.example.org',
      IMAP_USER: 'discovery@example.org',
      IMAP_PASSWORD: 'app-password',
      IMAP_PORT: '143',
      IMAP_SECURE: 'false',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.mailbox).toEqual({
      host: 'imap.example.org',
      port: 143,
      secure: false,
      user: 'discovery@example.org',
      password: 'app-password',
    });
  });

  it('fails fast when only some IMAP_* vars are set (a likely typo)', () => {
    expect(
      buildConfig({
        ...validEnv,
        IMAP_HOST: 'imap.example.org',
        IMAP_USER: 'discovery@example.org',
      }),
    ).toEqual({
      ok: false,
      error: 'IMAP_HOST, IMAP_USER and IMAP_PASSWORD must all be set together, or all omitted',
    });
  });

  it('rejects a non-positive IMAP_PORT', () => {
    expect(
      buildConfig({
        ...validEnv,
        IMAP_HOST: 'imap.example.org',
        IMAP_USER: 'discovery@example.org',
        IMAP_PASSWORD: 'app-password',
        IMAP_PORT: '0',
      }),
    ).toEqual({ ok: false, error: 'IMAP_PORT must be a positive number, got "0"' });
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

  it('defaults MAX_SEARCHES to 20 and reads an override', () => {
    const def = buildConfig(validEnv);
    expect(def.ok && def.config.maxSearches).toBe(20);
    const over = buildConfig({ ...validEnv, MAX_SEARCHES: '5' });
    expect(over.ok && over.config.maxSearches).toBe(5);
  });

  it.each(['0', 'abc'])('rejects MAX_SEARCHES=%s', (value) => {
    expect(buildConfig({ ...validEnv, MAX_SEARCHES: value })).toEqual({
      ok: false,
      error: `MAX_SEARCHES must be a positive number, got "${value}"`,
    });
  });

  it('rejects a non-positive MAX_PRS', () => {
    expect(buildConfig({ ...validEnv, MAX_PRS: '0' })).toEqual({
      ok: false,
      error: 'MAX_PRS must be a positive number, got "0"',
    });
  });

  // I7 from the final review: extraction (chat-completions) and
  // classification (Decisions API) are different endpoints. A single
  // LLM_BASE_URL applied to both breaks whichever one the operator wasn't
  // trying to proxy, so each needs its own override.
  it('keeps LLM_BASE_URL (extraction) and LLM_BASE_URL_CLASSIFY independent', () => {
    const result = buildConfig({
      ...validEnv,
      LLM_BASE_URL: 'https://proxy.example/extract',
      LLM_BASE_URL_CLASSIFY: 'https://proxy.example/classify',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.extract.baseUrl).toBe('https://proxy.example/extract');
    expect(result.config.classify.baseUrl).toBe('https://proxy.example/classify');
  });

  it('does not let LLM_BASE_URL leak into the classify endpoint', () => {
    const result = buildConfig({ ...validEnv, LLM_BASE_URL: 'https://proxy.example/extract' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.classify.baseUrl).not.toBe('https://proxy.example/extract');
  });

  it('defaults MAX_PAGES_PER_SOURCE to 40', () => {
    const result = buildConfig(validEnv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.maxPagesPerSource).toBe(40);
  });

  it('rejects a non-positive MAX_PAGES_PER_SOURCE', () => {
    expect(buildConfig({ ...validEnv, MAX_PAGES_PER_SOURCE: '0' })).toEqual({
      ok: false,
      error: 'MAX_PAGES_PER_SOURCE must be a positive number, got "0"',
    });
  });
});
