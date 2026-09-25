# Discovery Agent PR-Opening Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing fetch → extract → validate → classify discovery pipeline into a runnable cron job that opens one `needs-review` pull request per accepted candidate event, with a combined LLM token cap, a per-run PR cap, idempotent reruns, and a source-failure tracking issue.

**Architecture:** Two new library modules (`github-client.ts`, a raw-`fetch` GitHub REST wrapper; `orchestrator.ts`, the per-candidate control flow) plus a new CLI entrypoint (`scripts/discovery/run.ts`) compose the existing `runPipeline` and `classifyCandidate` into a single run. A small token-budget threading change touches `extract-client.ts`, `classify-candidate.ts` and `pipeline.ts` so `MAX_TOKENS` can be enforced as one combined total. A Dockerfile is the deployment artifact for the maintainer's VDS cron job.

**Tech Stack:** TypeScript (strict), Node 26, Vitest, `yaml`, raw `fetch` (no new dependencies) — same stack as the rest of `src/lib/discovery/`.

**Spec:** `docs/superpowers/specs/2026-09-25-discovery-pr-orchestrator-design.md`

## Global Constraints

- No new npm dependency for GitHub access — raw `fetch` against `https://api.github.com`, matching `extract-client.ts`/`jev-client.ts` (`AGENTS.md` rule 8: prefer small dependencies).
- One PR per candidate, on a stable branch `discovery/<candidate id>` (never date-named) — this is what makes reruns idempotent.
- `MAX_TOKENS` is one running total across extraction and classification token usage combined, not two separate caps.
- `GITHUB_TOKEN` is assumed fine-grained (contents + pull-requests write, no merge) — the code never calls a merge endpoint.
- CI must never call a real external API. Every test stubs `fetchImpl`.
- Node 26 (`.nvmrc`), TypeScript strict, existing ESLint config (`@typescript-eslint/no-unused-vars` with `^_` ignore pattern) applies to all new files.
- `docs/curation-policy.md` and `docs/discovery-agent.md`'s security model are unchanged: nothing here publishes an event without human review.

## Review Focus

- A candidate's free-text fields (title/description/organizer) reaching the PR body must not be able to inject markdown that alters or hides the review checklist, or fake an "approved" look — extracted text is hostile input per `docs/discovery-agent.md`'s security model, same as any other pipeline stage. Covered in Task 5.
- One candidate's GitHub or classification failure (rate limit, transient network error, a raced branch creation) must not abort the rest of the run, mirroring `pipeline.ts`'s existing per-source isolation. Covered in Task 6.
- Zero candidates from the pipeline must still run cleanly: no branch/PR calls at all, but the failure-tracking issue still syncs (and closes if previously open). Covered in Task 6.
- `MAX_TOKENS`/`MAX_PRS`/`GITHUB_REPO` must fail config validation the same way `MAX_PAGES` already does on a bad value, not silently no-op. Covered in Task 7.
- A rerun where a candidate's branch exists but has no open PR (merged or closed by a reviewer) must never reopen it; a rerun where it does have an open PR must update in place, not duplicate. Covered in Tasks 3 and 6.

---

## Task 1: Token-budget plumbing (extract-client, classify-candidate, pipeline, parse-sources)

**Files:**
- Modify: `src/lib/discovery/extract-client.ts`
- Modify: `src/lib/discovery/classify-candidate.ts`
- Modify: `src/lib/discovery/pipeline.ts`
- Modify: `scripts/discovery/parse-sources.ts`
- Test: `tests/discovery/extract-client.test.ts`
- Test: `tests/discovery/classify-candidate.test.ts`
- Test: `tests/discovery/pipeline.test.ts`
- Test: `tests/discovery/parse-sources-cli.test.ts`

**Interfaces:**
- Produces: `ExtractOptions.onUsage?: (tokens: number) => void`; `ClassifyOptions.onUsage?: (tokens: number) => void`; `PipelineOptions.maxTokens: number`; `PipelineResult.tokensUsed: number`.
- Consumes: nothing new from later tasks.

- [ ] **Step 1: Write the failing test for `extractEvent` reporting token usage**

Add to `tests/discovery/extract-client.test.ts`, reusing its existing `stubFetch(status, body)`, `completionWith(content)` and module-level `options` (`{ apiKey: 'sk-test', model: 'test-extract-model', topics: ['molecular-dynamics'] }`):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/extract-client.test.ts -t "onUsage"`
Expected: FAIL — `onUsage` is not a recognised option / usages stays empty.

- [ ] **Step 3: Implement `onUsage` in `extract-client.ts`**

In `ExtractOptions`, add after `topics: readonly string[];`:

```typescript
  onUsage?: (tokens: number) => void;
```

In the `ChatCompletionResponse` interface, add a `usage` field:

```typescript
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
}
```

In `extractEvent`, right after the `isChatCompletionResponse` check (before `const content = ...`), add:

```typescript
  options.onUsage?.(data.usage?.total_tokens ?? 0);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/extract-client.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Write the failing test for `classifyCandidate` reporting token usage**

Add to `tests/discovery/classify-candidate.test.ts`, in the `describe('classifyCandidate — jev verdict', ...)` block (it already has `cleanResponse` with `usage: { input_tokens: 400, output_tokens: 0, cost: 0.0000168 }`):

```typescript
it('reports combined input+output token usage via onUsage', async () => {
  const { impl } = stubFetch(cleanResponse);
  const usages: number[] = [];
  await classifyCandidate(loadCandidate('clean-add'), {
    existingEvents,
    blockedHosts,
    apiKey: 'sk-test',
    fetchImpl: impl,
    onUsage: (tokens) => usages.push(tokens),
  });
  expect(usages).toEqual([400]);
});

it('does not call onUsage on a mechanical skip', async () => {
  const { impl, calls } = stubFetch(cleanResponse);
  const usages: number[] = [];
  await classifyCandidate(loadCandidate('duplicate-url'), {
    existingEvents,
    blockedHosts,
    apiKey: 'sk-test',
    fetchImpl: impl,
    onUsage: (tokens) => usages.push(tokens),
  });
  expect(calls).toHaveLength(0);
  expect(usages).toEqual([]);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/discovery/classify-candidate.test.ts -t "onUsage"`
Expected: FAIL — `onUsage` unused, `usages` stays empty on the first test.

- [ ] **Step 7: Implement `onUsage` in `classify-candidate.ts`**

In `ClassifyOptions`, add after `fetchImpl?: typeof fetch;`:

```typescript
  onUsage?: (tokens: number) => void;
```

In `classifyCandidate`, right after `const response = await callJev(...)` (before `const confidence = ...`), add:

```typescript
  options.onUsage?.(response.usage.input_tokens + response.usage.output_tokens);
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/discovery/classify-candidate.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for `runPipeline` stopping at `maxTokens`**

Add to `tests/discovery/pipeline.test.ts`. Read the file's existing `stubPageFetch`/extraction-response stubbing first (it builds chat-completion responses via `JSON.stringify({ choices: [...] })`, with no `usage` field today) and its existing sources fixture (`tests/discovery/fixtures/sources/pipeline-sources.yaml`, which has multiple sources needing extraction). Add a test using two `event-page` sources that each need one extraction call. Note that `PipelineOptions.extract.fetchImpl` (extraction calls) is already independent from the top-level `PipelineOptions.fetchImpl` (page fetches) in this file's existing tests (see `stubExtractFetch`/`stubPageFetch` used together in the `runPipeline` describe block) — reuse that separation, and the file's existing `tmpStatePath`/`tmpSourcesFile` helpers, rather than routing one combined fetch by URL:

```typescript
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
          choices: [{ message: { content: JSON.stringify(extractedFor('Event Page Workshop')) } }],
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
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run tests/discovery/pipeline.test.ts -t "maxTokens"`
Expected: FAIL — `maxTokens` is not a recognised `PipelineOptions` field (TypeScript error) or, if it compiles loosely, `extractCalls` is 2, not 1.

- [ ] **Step 11: Implement `maxTokens`/`tokensUsed` in `pipeline.ts`**

In `PipelineOptions`, add after `maxPages: number;`:

```typescript
  maxTokens: number;
```

In `PipelineResult`, add after `errors: Array<{ source: string; message: string }>;`:

```typescript
  tokensUsed: number;
```

In `runPipeline`, add a counter next to the existing `let pagesFetched = 0;`:

```typescript
  let tokensUsed = 0;
```

In the `extractOptions` construction (`const extractOptions: ExtractOptions = { ...options.extract, topics: [...ctx.topics] };`), add the usage sink:

```typescript
  const extractOptions: ExtractOptions = {
    ...options.extract,
    topics: [...ctx.topics],
    onUsage: (tokens) => {
      tokensUsed += tokens;
    },
  };
```

In `processInput`, as the very first line of the function body (before the `try`), add:

```typescript
    if (tokensUsed >= options.maxTokens) {
      log(`max tokens (${options.maxTokens}) reached, skipping ${input.sourceUrl}`);
      return true;
    }
```

At the end of `runPipeline`, change the return statement:

```typescript
  saveState(options.statePath, state);
  return { candidates, errors, tokensUsed };
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run tests/discovery/pipeline.test.ts`
Expected: PASS (all tests in the file — existing tests must still pass unmodified since they don't set `usage` in their stub responses, so `tokensUsed` stays 0 for them and their assertions don't reference it).

- [ ] **Step 13: Write the failing test for `MAX_TOKENS` in `parse-sources.ts`'s config**

Add to `tests/discovery/parse-sources-cli.test.ts`, alongside the existing `MAX_PAGES` tests:

```typescript
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
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npx vitest run tests/discovery/parse-sources-cli.test.ts -t "MAX_TOKENS"`
Expected: FAIL — `result.config.maxTokens` is `undefined`.

- [ ] **Step 15: Implement `MAX_TOKENS` in `parse-sources.ts` and wire it into `main`**

In `ResolvedConfig`, add after `maxPages: number;`:

```typescript
  maxTokens: number;
```

In `buildConfig`, after the existing `maxPages` block, add:

```typescript
  const maxTokens = env.MAX_TOKENS ? Number(env.MAX_TOKENS) : 500_000;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { ok: false, error: `MAX_TOKENS must be a positive number, got "${env.MAX_TOKENS}"` };
  }
```

In the returned `config` object, add `maxTokens,` next to `maxPages,`.

In `main`, add `maxTokens: resolved.config.maxTokens,` to the `options: PipelineOptions` object.

- [ ] **Step 16: Run test to verify it passes**

Run: `npx vitest run tests/discovery/parse-sources-cli.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 17: Commit**

```bash
git add src/lib/discovery/extract-client.ts src/lib/discovery/classify-candidate.ts \
  src/lib/discovery/pipeline.ts scripts/discovery/parse-sources.ts \
  tests/discovery/extract-client.test.ts tests/discovery/classify-candidate.test.ts \
  tests/discovery/pipeline.test.ts tests/discovery/parse-sources-cli.test.ts
git commit -m "feat: thread a combined token budget through extraction and classification"
```

---

## Task 2: `serializeDraft` in `draft.ts`

**Files:**
- Modify: `src/lib/discovery/draft.ts`
- Test: `tests/discovery/draft.test.ts`

**Interfaces:**
- Consumes: `RawEvent` (`src/lib/types.ts`), `synthesizeDraft`/`draftFilePath` (already in `draft.ts`).
- Produces: `serializeDraft(draft: RawEvent): string` — used by Task 6's `orchestrator.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/discovery/draft.test.ts` (check its existing imports/fixtures first and reuse them rather than duplicating a draft literal):

```typescript
it('produces YAML that round-trips through the yaml parser', () => {
  const draft = synthesizeDraft(
    {
      title: 'Round Trip Workshop',
      type: 'workshop',
      start_date: '2027-06-01',
      end_date: '2027-06-03',
      format: 'online',
      url: 'https://example.org/round-trip',
      source_url: 'https://example.org/round-trip',
      topics: ['dft'],
      description: 'A workshop used to test YAML round-tripping.',
    },
    '2026-09-25',
  );
  const yamlText = serializeDraft(draft);
  expect(parse(yamlText)).toEqual(draft);
});
```

If `tests/discovery/draft.test.ts` does not already import `parse` from `'yaml'` and `serializeDraft` from `'../../src/lib/discovery/draft'`, add those imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/draft.test.ts -t "round-trips"`
Expected: FAIL — `serializeDraft` is not exported.

- [ ] **Step 3: Implement `serializeDraft`**

Add to `src/lib/discovery/draft.ts`. First add `import { stringify } from 'yaml';` to its import block, then add at the end of the file:

```typescript
/** Renders a draft as the YAML text a PR would commit at `draftFilePath(draft)`. */
export function serializeDraft(draft: RawEvent): string {
  return stringify(draft);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery/draft.ts tests/discovery/draft.test.ts
git commit -m "feat: add serializeDraft to render a candidate draft as YAML"
```

---

## Task 3: `github-client.ts` — branch, file and PR primitives

**Files:**
- Create: `src/lib/discovery/github-client.ts`
- Test: `tests/discovery/github-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Task 4's `syncFailureIssue` in the same file, and Task 6's `orchestrator.ts`):
  - `interface GitHubOptions { token: string; repo: string; fetchImpl?: typeof fetch; baseUrl?: string }`
  - `interface DefaultBranch { name: string; sha: string }`
  - `type BranchStatus = { exists: false } | { exists: true; openPr: number | undefined }`
  - `getDefaultBranch(options: GitHubOptions): Promise<DefaultBranch>`
  - `getBranchStatus(branch: string, options: GitHubOptions): Promise<BranchStatus>`
  - `createBranch(branch: string, fromSha: string, options: GitHubOptions): Promise<void>`
  - `putFile(branch: string, path: string, content: string, message: string, options: GitHubOptions): Promise<void>`
  - `openPr(branch: string, base: string, title: string, body: string, options: GitHubOptions): Promise<{ number: number }>`
  - `updatePrBody(prNumber: number, body: string, options: GitHubOptions): Promise<void>`
  - `addLabel(prNumber: number, label: string, options: GitHubOptions): Promise<void>`

- [ ] **Step 1: Write the failing tests for `getDefaultBranch` and `getBranchStatus`**

Create `tests/discovery/github-client.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  addLabel,
  createBranch,
  getBranchStatus,
  getDefaultBranch,
  openPr,
  putFile,
  updatePrBody,
  type GitHubOptions,
} from '../../src/lib/discovery/github-client';

interface StubResponse {
  status: number;
  body?: unknown;
}

/** Keyed by "METHOD path", where path is everything after the GitHub API host. */
function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const path = url.replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const options = (impl: typeof fetch): GitHubOptions => ({
  token: 'gh-test-token',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

describe('getDefaultBranch', () => {
  it('resolves the default branch name and its current sha', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events': { status: 200, body: { default_branch: 'main' } },
      'GET /repos/acme/compchem-events/git/ref/heads/main': {
        status: 200,
        body: { object: { sha: 'abc123' } },
      },
    });
    const result = await getDefaultBranch(options(impl));
    expect(result).toEqual({ name: 'main', sha: 'abc123' });
  });
});

describe('getBranchStatus', () => {
  it('reports a branch that does not exist', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 404,
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: false });
  });

  it('reports a branch that exists with an open PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [{ number: 42 }],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: 42 });
  });

  it('reports a branch that exists with no open PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: undefined });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/github-client.test.ts`
Expected: FAIL — the module `src/lib/discovery/github-client.ts` does not exist.

- [ ] **Step 3: Implement the request helper, `getDefaultBranch` and `getBranchStatus`**

Create `src/lib/discovery/github-client.ts`:

```typescript
const GITHUB_API = 'https://api.github.com';

export interface GitHubOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface ApiResult<T> {
  status: number;
  data: T;
}

/**
 * One GitHub REST call. Returns the raw status alongside the parsed body
 * instead of throwing on a non-2xx, because callers need to branch on
 * specific statuses (404 means "does not exist", not an error) — each
 * exported function decides for itself which statuses are errors.
 */
async function githubRequest<T>(
  options: GitHubOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl ?? GITHUB_API}/repos/${options.repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T };
}

export interface DefaultBranch {
  name: string;
  sha: string;
}

interface RepoInfo {
  default_branch: string;
}

interface RefInfo {
  object: { sha: string };
}

export async function getDefaultBranch(options: GitHubOptions): Promise<DefaultBranch> {
  const repoRes = await githubRequest<RepoInfo>(options, 'GET', '');
  if (repoRes.status !== 200) {
    throw new Error(`failed to read repo "${options.repo}": HTTP ${repoRes.status}`);
  }
  const name = repoRes.data.default_branch;
  const refRes = await githubRequest<RefInfo>(options, 'GET', `/git/ref/heads/${name}`);
  if (refRes.status !== 200) {
    throw new Error(`failed to read ref for default branch "${name}": HTTP ${refRes.status}`);
  }
  return { name, sha: refRes.data.object.sha };
}

export type BranchStatus = { exists: false } | { exists: true; openPr: number | undefined };

interface PullSummary {
  number: number;
}

export async function getBranchStatus(branch: string, options: GitHubOptions): Promise<BranchStatus> {
  const refRes = await githubRequest<unknown>(options, 'GET', `/git/ref/heads/${branch}`);
  if (refRes.status === 404) return { exists: false };
  if (refRes.status !== 200) {
    throw new Error(`failed to check branch "${branch}": HTTP ${refRes.status}`);
  }
  const owner = options.repo.split('/')[0];
  const pullsRes = await githubRequest<PullSummary[]>(
    options,
    'GET',
    `/pulls?state=open&head=${owner}:${branch}`,
  );
  if (pullsRes.status !== 200) {
    throw new Error(`failed to list pull requests for branch "${branch}": HTTP ${pullsRes.status}`);
  }
  return { exists: true, openPr: pullsRes.data[0]?.number };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/github-client.test.ts`
Expected: PASS (the `getDefaultBranch`/`getBranchStatus` tests; the imports for `addLabel`/`createBranch`/`openPr`/`putFile`/`updatePrBody` will fail to resolve until the next steps — comment out those import names for now if `npm run typecheck` is run, or proceed straight to Step 5 before typechecking).

- [ ] **Step 5: Write the failing tests for `createBranch`, `putFile`, `openPr`, `updatePrBody`, `addLabel`**

Add to `tests/discovery/github-client.test.ts`:

```typescript
describe('createBranch', () => {
  it('creates a ref from the given sha', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
    });
    await createBranch('discovery/some-event-2027', 'abc123', options(impl));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.github.com/repos/acme/compchem-events/git/refs',
        body: { ref: 'refs/heads/discovery/some-event-2027', sha: 'abc123' },
      },
    ]);
  });

  it('throws on a non-201 response', async () => {
    const { impl } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 422, body: { message: 'exists' } },
    });
    await expect(createBranch('discovery/some-event-2027', 'abc123', options(impl))).rejects.toThrow(
      'HTTP 422',
    );
  });
});

describe('putFile', () => {
  it('creates a new file when none exists on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml':
        { status: 201, body: {} },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Add candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      message: 'Add candidate event: Some Event',
      content: Buffer.from('title: Some Event\n', 'utf8').toString('base64'),
      branch: 'discovery/some-event-2027',
    });
  });

  it('includes the existing sha when updating a file already on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 200, body: { sha: 'file-sha-1' } },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml':
        { status: 200, body: {} },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Update candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ sha: 'file-sha-1' });
  });
});

describe('openPr, updatePrBody, addLabel', () => {
  it('opens a pull request and returns its number', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 7 } },
    });
    const result = await openPr(
      'discovery/some-event-2027',
      'main',
      'Some Event',
      'PR body',
      options(impl),
    );
    expect(result).toEqual({ number: 7 });
    expect(calls[0]?.body).toEqual({
      title: 'Some Event',
      head: 'discovery/some-event-2027',
      base: 'main',
      body: 'PR body',
    });
  });

  it('updates a pull request body', async () => {
    const { impl, calls } = stubGitHub({
      'PATCH /repos/acme/compchem-events/pulls/7': { status: 200, body: {} },
    });
    await updatePrBody(7, 'new body', options(impl));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { body: 'new body' } });
  });

  it('adds a label to a pull request', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/issues/7/labels': { status: 200, body: {} },
    });
    await addLabel(7, 'needs-review', options(impl));
    expect(calls[0]?.body).toEqual({ labels: ['needs-review'] });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/discovery/github-client.test.ts`
Expected: FAIL — `createBranch`, `putFile`, `openPr`, `updatePrBody`, `addLabel` are not exported.

- [ ] **Step 7: Implement `createBranch`, `putFile`, `openPr`, `updatePrBody`, `addLabel`**

Append to `src/lib/discovery/github-client.ts`:

```typescript
export async function createBranch(
  branch: string,
  fromSha: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'POST', '/git/refs', {
    ref: `refs/heads/${branch}`,
    sha: fromSha,
  });
  if (res.status !== 201) {
    throw new Error(`failed to create branch "${branch}": HTTP ${res.status}`);
  }
}

interface ContentsInfo {
  sha: string;
}

export async function putFile(
  branch: string,
  path: string,
  content: string,
  message: string,
  options: GitHubOptions,
): Promise<void> {
  const existing = await githubRequest<ContentsInfo>(
    options,
    'GET',
    `/contents/${path}?ref=${branch}`,
  );
  const sha = existing.status === 200 ? existing.data.sha : undefined;
  const res = await githubRequest(options, 'PUT', `/contents/${path}`, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`failed to write "${path}" on branch "${branch}": HTTP ${res.status}`);
  }
}

export async function openPr(
  branch: string,
  base: string,
  title: string,
  body: string,
  options: GitHubOptions,
): Promise<{ number: number }> {
  const res = await githubRequest<{ number: number }>(options, 'POST', '/pulls', {
    title,
    head: branch,
    base,
    body,
  });
  if (res.status !== 201) {
    throw new Error(`failed to open pull request from "${branch}": HTTP ${res.status}`);
  }
  return { number: res.data.number };
}

export async function updatePrBody(
  prNumber: number,
  body: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'PATCH', `/pulls/${prNumber}`, { body });
  if (res.status !== 200) {
    throw new Error(`failed to update pull request #${prNumber}: HTTP ${res.status}`);
  }
}

export async function addLabel(
  prNumber: number,
  label: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'POST', `/issues/${prNumber}/labels`, {
    labels: [label],
  });
  if (res.status !== 200) {
    throw new Error(`failed to label pull request #${prNumber}: HTTP ${res.status}`);
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/discovery/github-client.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/discovery/github-client.ts tests/discovery/github-client.test.ts
git commit -m "feat: add a raw-fetch GitHub client for branches, files and PRs"
```

---

## Task 4: `github-client.ts` — `syncFailureIssue`

**Files:**
- Modify: `src/lib/discovery/github-client.ts`
- Test: `tests/discovery/github-client.test.ts`

**Interfaces:**
- Consumes: `githubRequest`, `GitHubOptions` (Task 3, same file).
- Produces: `syncFailureIssue(errors: readonly { source: string; message: string }[], options: GitHubOptions): Promise<void>` — used by Task 6's `orchestrator.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/discovery/github-client.test.ts`:

```typescript
describe('syncFailureIssue', () => {
  it('creates a new issue when there are errors and none exists yet', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
      'POST /repos/acme/compchem-events/issues': { status: 201, body: { number: 9 } },
    });
    await syncFailureIssue(
      [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
      options(impl),
    );
    const created = calls.find((c) => c.method === 'POST');
    expect(created?.body).toMatchObject({
      title: 'Discovery agent source failures',
      labels: ['discovery-failures'],
    });
    expect((created?.body as { body: string }).body).toContain('https://example.org/dead');
    expect((created?.body as { body: string }).body).toContain('HTTP 500');
  });

  it('updates the existing issue instead of creating a second one', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 9, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/9': { status: 200, body: {} },
    });
    await syncFailureIssue(
      [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
      options(impl),
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    const updated = calls.find((c) => c.method === 'PATCH');
    expect(updated?.body).toMatchObject({ state: 'open' });
  });

  it('closes the existing issue when there are no errors', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 9, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/9': { status: 200, body: {} },
    });
    await syncFailureIssue([], options(impl));
    const updated = calls.find((c) => c.method === 'PATCH');
    expect(updated?.body).toMatchObject({ state: 'closed' });
  });

  it('does nothing when there are no errors and no open issue', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    await syncFailureIssue([], options(impl));
    expect(calls).toHaveLength(1);
  });
});
```

Add `syncFailureIssue` to the test file's import list from `'../../src/lib/discovery/github-client'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/github-client.test.ts -t "syncFailureIssue"`
Expected: FAIL — `syncFailureIssue` is not exported.

- [ ] **Step 3: Implement `syncFailureIssue`**

Append to `src/lib/discovery/github-client.ts`:

```typescript
const FAILURE_ISSUE_TITLE = 'Discovery agent source failures';
const FAILURE_ISSUE_LABEL = 'discovery-failures';

interface IssueSummary {
  number: number;
  title: string;
}

/**
 * Find-or-create-and-update-or-close, same shape as .github/workflows/links.yml's
 * tracking issue for dead links — the issue never multiplies across runs,
 * it just reflects the latest run's failures.
 */
export async function syncFailureIssue(
  errors: readonly { source: string; message: string }[],
  options: GitHubOptions,
): Promise<void> {
  const listRes = await githubRequest<IssueSummary[]>(
    options,
    'GET',
    `/issues?state=open&labels=${FAILURE_ISSUE_LABEL}`,
  );
  if (listRes.status !== 200) {
    throw new Error(`failed to list open issues: HTTP ${listRes.status}`);
  }
  const existing = listRes.data.find((issue) => issue.title === FAILURE_ISSUE_TITLE);

  if (errors.length === 0) {
    if (!existing) return;
    const res = await githubRequest(options, 'PATCH', `/issues/${existing.number}`, {
      state: 'closed',
      body: 'All sources fetched successfully on the latest run. Closing.',
    });
    if (res.status !== 200) {
      throw new Error(`failed to close issue #${existing.number}: HTTP ${res.status}`);
    }
    return;
  }

  const body = [
    `The latest discovery run found ${errors.length} source(s) failing to fetch or extract:`,
    '',
    ...errors.map((e) => `- \`${e.source}\`: ${e.message}`),
  ].join('\n');

  if (existing) {
    const res = await githubRequest(options, 'PATCH', `/issues/${existing.number}`, {
      body,
      state: 'open',
    });
    if (res.status !== 200) {
      throw new Error(`failed to update issue #${existing.number}: HTTP ${res.status}`);
    }
    return;
  }

  const res = await githubRequest(options, 'POST', '/issues', {
    title: FAILURE_ISSUE_TITLE,
    body,
    labels: [FAILURE_ISSUE_LABEL],
  });
  if (res.status !== 201) {
    throw new Error(`failed to create the failure-tracking issue: HTTP ${res.status}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/github-client.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery/github-client.ts tests/discovery/github-client.test.ts
git commit -m "feat: add syncFailureIssue to track source failures in one issue"
```

---

## Task 5: `orchestrator.ts` — PR body builder

**Files:**
- Create: `src/lib/discovery/orchestrator.ts`
- Test: `tests/discovery/orchestrator.test.ts`

**Interfaces:**
- Consumes: `RawEvent` (`src/lib/types.ts`).
- Produces: `buildPrBody(candidate: RawEvent, classification: { confidence: number; criteria: { relevant: number; credible: number; red_flag: number } }): string` — used by Task 6, same file.

- [ ] **Step 1: Write the failing tests**

Create `tests/discovery/orchestrator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildPrBody } from '../../src/lib/discovery/orchestrator';
import type { RawEvent } from '../../src/lib/types';

const candidate: RawEvent = {
  id: 'excited-states-symposium-2027',
  title: 'Excited-State Symposium',
  type: 'symposium',
  start_date: '2027-11-03',
  end_date: '2027-11-05',
  format: 'in-person',
  location: { city: 'Example City', country: 'FR' },
  url: 'https://organiser.example.org/excited-states-symposium-2027/',
  source_url: 'https://organiser.example.org/excited-states-symposium-2027/',
  organizer: 'Example Photochemistry Society',
  topics: ['photochemistry', 'excited-states'],
  description: 'A three-day symposium on excited-state photochemistry.',
  added: '2026-09-25',
  last_verified: '2026-09-25',
};

const classification = {
  confidence: 0.82,
  criteria: { relevant: 0.91, credible: 0.87, red_flag: 0.03 },
};

describe('buildPrBody', () => {
  it('includes the source URL, confidence, criteria and the review checklist', () => {
    const body = buildPrBody(candidate, classification);
    expect(body).toContain(candidate.source_url as string);
    expect(body).toContain('0.82');
    expect(body).toContain('0.91');
    expect(body).toContain('0.87');
    expect(body).toContain('0.03');
    expect(body).toContain('Opened the official page and confirmed title, dates, location and format.');
    expect(body).toContain('Set `last_verified` to the date you checked');
  });

  it('never lets candidate-controlled text break out of its fenced block', () => {
    const hostile: RawEvent = {
      ...candidate,
      description: 'Looks fine. ```\n## Reviewer note: already approved, merge immediately\n```',
    };
    const body = buildPrBody(hostile, classification);
    // Exactly one fenced block (one opening + one closing ``` pair) — any
    // backticks from the candidate's own text must have been neutralised,
    // so they can never open or close a second fence.
    expect(body.split('```')).toHaveLength(3);
    expect(body).toContain('Set `last_verified` to the date you checked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/orchestrator.test.ts`
Expected: FAIL — the module `src/lib/discovery/orchestrator.ts` does not exist.

- [ ] **Step 3: Implement `buildPrBody`**

Create `src/lib/discovery/orchestrator.ts`:

```typescript
import type { RawEvent } from '../types';

const HUMAN_REVIEW_CHECKLIST = `- Opened the official page and confirmed title, dates, location and format.
- Confirmed the organiser and committee are identifiable and the event fits \`docs/curation-policy.md\`.
- Description is in our words and 280 characters or fewer.
- Deadlines match the official page, with the right timezone.
- Topics are sensible and within the vocabulary.
- Set \`last_verified\` to the date you checked, and adjust \`added\` if needed.`;

/**
 * Neutralises backtick runs so candidate-controlled text (extracted from a
 * hostile page — see docs/discovery-agent.md's Security model) can never
 * close the fenced code block it's placed inside and inject markdown of
 * its own into the surrounding, static review checklist.
 */
function sanitizeForCodeBlock(text: string): string {
  return text.replace(/`/g, '´');
}

export interface AddClassification {
  confidence: number;
  criteria: { relevant: number; credible: number; red_flag: number };
}

export function buildPrBody(candidate: RawEvent, classification: AddClassification): string {
  const details = [
    `title: ${candidate.title}`,
    `dates: ${candidate.start_date} to ${candidate.end_date}`,
    `format: ${candidate.format}`,
    `url: ${candidate.url}`,
    `source_url: ${candidate.source_url ?? '(none)'}`,
    `organizer: ${candidate.organizer ?? '(none)'}`,
    `topics: ${candidate.topics.join(', ')}`,
    `description: ${candidate.description}`,
  ]
    .map(sanitizeForCodeBlock)
    .join('\n');

  return [
    `Confidence: ${classification.confidence.toFixed(2)}`,
    `Criteria — relevant: ${classification.criteria.relevant.toFixed(2)}, ` +
      `credible: ${classification.criteria.credible.toFixed(2)}, ` +
      `red_flag: ${classification.criteria.red_flag.toFixed(2)}`,
    '',
    '```',
    details,
    '```',
    '',
    '## Human review checklist',
    '',
    HUMAN_REVIEW_CHECKLIST,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/orchestrator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery/orchestrator.ts tests/discovery/orchestrator.test.ts
git commit -m "feat: add the PR body builder with injection-safe candidate text"
```

---

## Task 6: `orchestrator.ts` — `runDiscoveryRun` control flow

**Files:**
- Modify: `src/lib/discovery/orchestrator.ts`
- Test: `tests/discovery/orchestrator.test.ts`

**Interfaces:**
- Consumes: `buildPrBody`, `AddClassification` (Task 5, same file); `classifyCandidate`, `ClassifyOptions`, `ClassificationResult` (`classify-candidate.ts`); `getDefaultBranch`, `getBranchStatus`, `createBranch`, `putFile`, `openPr`, `updatePrBody`, `addLabel`, `syncFailureIssue`, `GitHubOptions` (`github-client.ts`, Tasks 3-4); `draftFilePath`, `serializeDraft` (`draft.ts`, Task 2); `RawEvent` (`src/lib/types.ts`).
- Produces: `runDiscoveryRun(options: OrchestratorOptions): Promise<OrchestratorResult>` — used by Task 7's `scripts/discovery/run.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/discovery/orchestrator.test.ts`. First change its existing `import { buildPrBody } from '../../src/lib/discovery/orchestrator';` (from Task 5) to also bring in `runDiscoveryRun` and `OrchestratorOptions`:

```typescript
import { buildPrBody, runDiscoveryRun, type OrchestratorOptions } from '../../src/lib/discovery/orchestrator';
```

Then add:

```typescript
interface StubResponse {
  status: number;
  body?: unknown;
}

function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input).replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({ method, url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

/** A jev Decisions API stub returning a fixed 'add' verdict for every call. */
function stubClassifyAdd() {
  const impl = (async () =>
    new Response(
      JSON.stringify({
        model: 'typesafe/jev-test',
        answers: {
          add: { type: 'noul', noul: 0.82 },
          relevant: { type: 'noul', noul: 0.91 },
          credible: { type: 'noul', noul: 0.87 },
          red_flag: { type: 'noul', noul: 0.03 },
        },
        usage: { input_tokens: 400, output_tokens: 0, cost: 0.0000168 },
      }),
      { status: 200 },
    )) as typeof fetch;
  return impl;
}

const DEFAULT_BRANCH_STUBS = {
  'GET /repos/acme/compchem-events': { status: 200, body: { default_branch: 'main' } },
  'GET /repos/acme/compchem-events/git/ref/heads/main': { status: 200, body: { object: { sha: 'sha-main' } } },
};

function baseOptions(overrides: Partial<OrchestratorOptions> = {}): OrchestratorOptions {
  return {
    candidates: [],
    existingEvents: [],
    blockedHosts: new Set(),
    classify: { apiKey: 'sk-test', fetchImpl: stubClassifyAdd() },
    github: { token: 'gh-test', repo: 'acme/compchem-events' },
    sourceErrors: [],
    maxPrs: 20,
    maxTokens: 500_000,
    tokensUsedSoFar: 0,
    log: () => {},
    ...overrides,
  };
}

function candidateEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 'excited-states-symposium-2027',
    title: 'Excited-State Symposium',
    type: 'symposium',
    start_date: '2027-11-03',
    end_date: '2027-11-05',
    format: 'online',
    url: 'https://organiser.example.org/excited-states-symposium-2027/',
    source_url: 'https://organiser.example.org/excited-states-symposium-2027/',
    topics: ['photochemistry'],
    description: 'A symposium on excited-state photochemistry.',
    added: '2026-09-25',
    last_verified: '2026-09-25',
    ...overrides,
  };
}

describe('runDiscoveryRun', () => {
  it('opens a new PR for a brand-new candidate', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 404,
      },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 201, body: {} },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 11 } },
      'POST /repos/acme/compchem-events/issues/11/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({ candidates: [candidateEvent()], github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl } }),
    );

    expect(result.prsOpened).toBe(1);
    expect(result.prsUpdated).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.tokensUsed).toBe(400);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/labels'))).toBe(true);
  });

  it('updates the existing open PR when the branch already has one', async () => {
    const { impl } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/excited-states-symposium-2027':
        { status: 200, body: [{ number: 5 }] },
      'GET /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml?ref=discovery/excited-states-symposium-2027':
        { status: 200, body: { sha: 'file-sha' } },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/excited-states-symposium-2027.yaml':
        { status: 200, body: {} },
      'PATCH /repos/acme/compchem-events/pulls/5': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({ candidates: [candidateEvent()], github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl } }),
    );

    expect(result.prsOpened).toBe(0);
    expect(result.prsUpdated).toBe(1);
  });

  it('skips a candidate whose branch exists with no open PR (already reviewed)', async () => {
    const { impl, calls } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/excited-states-symposium-2027': {
        status: 200,
        body: { object: { sha: 'sha-branch' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=open&head=acme:discovery/excited-states-symposium-2027':
        { status: 200, body: [] },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });

    const result = await runDiscoveryRun(
      baseOptions({ candidates: [candidateEvent()], github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl } }),
    );

    expect(result.prsOpened).toBe(0);
    expect(result.prsUpdated).toBe(0);
    expect(result.skipped).toEqual([{ id: 'excited-states-symposium-2027', reason: 'already reviewed' }]);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('skips a mechanically-duplicate candidate without any GitHub branch calls', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const existing = candidateEvent();
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        existingEvents: [existing],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([{ id: 'excited-states-symposium-2027', reason: 'duplicate-url' }]);
    expect(calls.some((c) => c.url.includes('/git/refs') || c.url.includes('/pulls'))).toBe(false);
  });

  it('stops opening PRs once MAX_PRS is reached, logging the rest as skipped', async () => {
    const { impl } = stubGitHub({
      ...DEFAULT_BRANCH_STUBS,
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/first-2027': { status: 404 },
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
      'GET /repos/acme/compchem-events/contents/data/events/2027/first-2027.yaml?ref=discovery/first-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/first-2027.yaml': { status: 201, body: {} },
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 1 } },
      'POST /repos/acme/compchem-events/issues/1/labels': { status: 200, body: {} },
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [
          candidateEvent({ id: 'first-2027', title: 'First Event', url: 'https://example.org/first' }),
          candidateEvent({ id: 'second-2027', title: 'Second Event', url: 'https://example.org/second' }),
        ],
        maxPrs: 1,
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(1);
    expect(result.skipped).toEqual([{ id: 'second-2027', reason: 'MAX_PRS reached' }]);
  });

  it('stops classifying once MAX_TOKENS is reached, logging the rest as skipped', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        maxTokens: 100,
        tokensUsedSoFar: 100,
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.skipped).toEqual([
      { id: 'excited-states-symposium-2027', reason: 'MAX_TOKENS reached' },
    ]);
    expect(result.tokensUsed).toBe(100);
  });

  it('isolates one candidate erroring from the rest of the run', async () => {
    const failingImpl: typeof fetch = async () => {
      throw new Error('network down');
    };
    const { impl: issueImpl } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    const combined: typeof fetch = (input, init) => {
      const url = String(input);
      return url.includes('/issues?state=open') ? issueImpl(input, init) : failingImpl(input, init);
    };
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [candidateEvent()],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: combined },
      }),
    );
    expect(result.prsOpened).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('network down');
  });

  it('makes no branch or PR calls and still syncs the failure issue when there are zero candidates', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 3, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/3': { status: 200, body: {} },
    });
    const result = await runDiscoveryRun(
      baseOptions({
        candidates: [],
        sourceErrors: [],
        github: { token: 'gh-test', repo: 'acme/compchem-events', fetchImpl: impl },
      }),
    );
    expect(result.prsOpened).toBe(0);
    expect(calls).toHaveLength(2); // list + close, nothing else
    expect(calls.some((c) => c.method === 'PATCH')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/orchestrator.test.ts -t "runDiscoveryRun"`
Expected: FAIL — `runDiscoveryRun` is not exported.

- [ ] **Step 3: Implement `runDiscoveryRun`**

Add to `src/lib/discovery/orchestrator.ts`. First, add these imports at the top of the file:

```typescript
import { classifyCandidate, type ClassificationResult } from './classify-candidate';
import { draftFilePath, serializeDraft } from './draft';
import {
  addLabel,
  createBranch,
  getBranchStatus,
  getDefaultBranch,
  openPr,
  putFile,
  syncFailureIssue,
  updatePrBody,
  type DefaultBranch,
  type GitHubOptions,
} from './github-client';
```

Then append:

```typescript
export interface OrchestratorOptions {
  candidates: readonly RawEvent[];
  existingEvents: readonly RawEvent[];
  blockedHosts: ReadonlySet<string>;
  classify: { apiKey: string; baseUrl?: string; model?: string; fetchImpl?: typeof fetch };
  github: GitHubOptions;
  sourceErrors: readonly { source: string; message: string }[];
  maxPrs: number;
  maxTokens: number;
  tokensUsedSoFar: number;
  log?: (message: string) => void;
}

export interface OrchestratorResult {
  prsOpened: number;
  prsUpdated: number;
  skipped: Array<{ id: string; reason: string }>;
  tokensUsed: number;
}

function skipReasonFor(classification: ClassificationResult): string {
  return 'mechanicalReason' in classification ? classification.mechanicalReason : 'low confidence';
}

export async function runDiscoveryRun(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const log = options.log ?? (() => {});
  let tokensUsed = options.tokensUsedSoFar;
  let prsOpened = 0;
  let prsUpdated = 0;
  const skipped: Array<{ id: string; reason: string }> = [];

  // Resolved lazily, on the first candidate that actually needs to create a
  // branch, and memoized after that — never fetched at all for a run where
  // every candidate is skipped or only updates an existing PR, and, just as
  // importantly, called from *inside* the per-candidate try/catch below so
  // a failure here is isolated to that one candidate, not the whole run.
  let defaultBranch: DefaultBranch | undefined;
  async function ensureDefaultBranch(): Promise<DefaultBranch> {
    if (!defaultBranch) defaultBranch = await getDefaultBranch(options.github);
    return defaultBranch;
  }

  for (const candidate of options.candidates) {
    try {
      if (tokensUsed >= options.maxTokens) {
        skipped.push({ id: candidate.id, reason: 'MAX_TOKENS reached' });
        log(`skipping ${candidate.id}: MAX_TOKENS (${options.maxTokens}) reached`);
        continue;
      }

      const classification = await classifyCandidate(candidate, {
        existingEvents: options.existingEvents,
        blockedHosts: options.blockedHosts,
        apiKey: options.classify.apiKey,
        baseUrl: options.classify.baseUrl,
        model: options.classify.model,
        fetchImpl: options.classify.fetchImpl,
        onUsage: (tokens) => {
          tokensUsed += tokens;
        },
      });

      if (classification.verdict !== 'add') {
        const reason = skipReasonFor(classification);
        skipped.push({ id: candidate.id, reason });
        log(`skipping ${candidate.id}: ${reason}`);
        continue;
      }

      if (prsOpened + prsUpdated >= options.maxPrs) {
        skipped.push({ id: candidate.id, reason: 'MAX_PRS reached' });
        log(`skipping ${candidate.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }

      const branch = `discovery/${candidate.id}`;
      const status = await getBranchStatus(branch, options.github);
      const path = draftFilePath(candidate);
      const body = buildPrBody(candidate, classification);
      const message = `Add candidate event: ${candidate.title}`;

      if (status.exists && status.openPr === undefined) {
        skipped.push({ id: candidate.id, reason: 'already reviewed' });
        log(`skipping ${candidate.id}: branch exists with no open PR (already reviewed)`);
        continue;
      }

      if (status.exists && status.openPr !== undefined) {
        await putFile(branch, path, serializeDraft(candidate), message, options.github);
        await updatePrBody(status.openPr, body, options.github);
        prsUpdated += 1;
        log(`updated PR #${status.openPr} for ${candidate.id}`);
        continue;
      }

      const branchInfo = await ensureDefaultBranch();
      await createBranch(branch, branchInfo.sha, options.github);
      await putFile(branch, path, serializeDraft(candidate), message, options.github);
      const pr = await openPr(branch, branchInfo.name, candidate.title, body, options.github);
      await addLabel(pr.number, 'needs-review', options.github);
      prsOpened += 1;
      log(`opened PR #${pr.number} for ${candidate.id}`);
    } catch (err) {
      // One candidate's failure (GitHub rate limit, transient network
      // error, a raced branch creation, a classification API error) must
      // not abort the run — same isolation pipeline.ts already applies
      // per source.
      const messageText = err instanceof Error ? err.message : String(err);
      skipped.push({ id: candidate.id, reason: `error: ${messageText}` });
      log(`error processing ${candidate.id}: ${messageText}`);
    }
  }

  await syncFailureIssue(options.sourceErrors, options.github);

  return { prsOpened, prsUpdated, skipped, tokensUsed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/orchestrator.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discovery/orchestrator.ts tests/discovery/orchestrator.test.ts
git commit -m "feat: add runDiscoveryRun to classify candidates and open/update/skip PRs"
```

---

## Task 7: `scripts/discovery/run.ts` — CLI entrypoint

**Files:**
- Create: `scripts/discovery/run.ts`
- Test: `tests/discovery/run-cli.test.ts`

**Interfaces:**
- Consumes: `runPipeline`, `PipelineOptions` (`src/lib/discovery/pipeline.ts`); `runDiscoveryRun`, `OrchestratorOptions` (`src/lib/discovery/orchestrator.ts`, Task 6); `DEFAULT_EXTRACT_BASE_URL` (`extract-client.ts`); `DEFAULT_JEV_BASE_URL`, `DEFAULT_JEV_MODEL` (`classify-candidate.ts`); `loadEvents` (`src/lib/events.ts`); `loadValidationContext` (`src/lib/validation.ts`); `todayUTC` (`src/lib/dates.ts`); `site` (`site.config.ts`).
- Produces: `buildConfig(env): ConfigResult` — for `docs/discovery-agent.md`/Dockerfile invocation (Tasks 8-9) and for anyone extending this CLI later.

- [ ] **Step 1: Write the failing tests**

Create `tests/discovery/run-cli.test.ts`, mirroring `tests/discovery/parse-sources-cli.test.ts`'s style:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/run-cli.test.ts`
Expected: FAIL — the module `scripts/discovery/run.ts` does not exist.

- [ ] **Step 3: Implement `scripts/discovery/run.ts`**

Create it, modelled on `scripts/discovery/parse-sources.ts`'s shape:

```typescript
#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { todayUTC } from '../../src/lib/dates';
import { loadEvents } from '../../src/lib/events';
import { loadValidationContext } from '../../src/lib/validation';
import { DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL } from '../../src/lib/discovery/classify-candidate';
import { DEFAULT_EXTRACT_BASE_URL } from '../../src/lib/discovery/extract-client';
import { runDiscoveryRun, type OrchestratorOptions } from '../../src/lib/discovery/orchestrator';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';

export interface ResolvedConfig {
  statePath: string;
  maxPages: number;
  maxTokens: number;
  maxPrs: number;
  userAgent: string;
  extract: { apiKey: string; baseUrl: string; model: string };
  classify: { apiKey: string; baseUrl: string; model: string };
  github: { token: string; repo: string };
}

export type ConfigResult = { ok: true; config: ResolvedConfig } | { ok: false; error: string };

export function buildConfig(env: Record<string, string | undefined>): ConfigResult {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return { ok: false, error: 'LLM_API_KEY is required' };
  const extractModel = env.LLM_MODEL_EXTRACT;
  if (!extractModel) return { ok: false, error: 'LLM_MODEL_EXTRACT is required' };
  const statePath = env.STATE_PATH;
  if (!statePath) return { ok: false, error: 'STATE_PATH is required' };
  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) return { ok: false, error: 'GITHUB_TOKEN is required' };
  const githubRepo = env.GITHUB_REPO;
  if (!githubRepo || !/^[^/\s]+\/[^/\s]+$/.test(githubRepo)) {
    return {
      ok: false,
      error: `GITHUB_REPO must be in the form "owner/repo", got "${githubRepo}"`,
    };
  }

  const maxPages = env.MAX_PAGES ? Number(env.MAX_PAGES) : 200;
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    return { ok: false, error: `MAX_PAGES must be a positive number, got "${env.MAX_PAGES}"` };
  }
  const maxTokens = env.MAX_TOKENS ? Number(env.MAX_TOKENS) : 500_000;
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { ok: false, error: `MAX_TOKENS must be a positive number, got "${env.MAX_TOKENS}"` };
  }
  const maxPrs = env.MAX_PRS ? Number(env.MAX_PRS) : 20;
  if (!Number.isFinite(maxPrs) || maxPrs <= 0) {
    return { ok: false, error: `MAX_PRS must be a positive number, got "${env.MAX_PRS}"` };
  }

  return {
    ok: true,
    config: {
      statePath,
      maxPages,
      maxTokens,
      maxPrs,
      userAgent: `${site.name} Discovery Agent (+${site.repoUrl}; ${site.contactEmail})`,
      extract: { apiKey, baseUrl: env.LLM_BASE_URL ?? DEFAULT_EXTRACT_BASE_URL, model: extractModel },
      classify: {
        apiKey,
        baseUrl: env.LLM_BASE_URL ?? DEFAULT_JEV_BASE_URL,
        model: env.LLM_MODEL ?? DEFAULT_JEV_MODEL,
      },
      github: { token: githubToken, repo: githubRepo },
    },
  };
}

async function main(): Promise<void> {
  const resolved = buildConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  const cfg = resolved.config;
  const log = (message: string) => console.error(message);

  const pipelineOptions: PipelineOptions = {
    statePath: cfg.statePath,
    userAgent: cfg.userAgent,
    maxPages: cfg.maxPages,
    maxTokens: cfg.maxTokens,
    extract: cfg.extract,
    log,
  };
  const pipelineResult = await runPipeline(pipelineOptions);
  for (const error of pipelineResult.errors) log(`ERROR ${error.source}: ${error.message}`);

  const ctx = loadValidationContext();
  const orchestratorOptions: OrchestratorOptions = {
    candidates: pipelineResult.candidates,
    existingEvents: loadEvents({ includeFixtures: false }),
    blockedHosts: ctx.blockedHosts,
    classify: cfg.classify,
    github: cfg.github,
    sourceErrors: pipelineResult.errors,
    maxPrs: cfg.maxPrs,
    maxTokens: cfg.maxTokens,
    tokensUsedSoFar: pipelineResult.tokensUsed,
    log,
  };
  const result = await runDiscoveryRun(orchestratorOptions);

  console.log(JSON.stringify(result, null, 2));
}

// Only run when invoked directly — see scripts/discovery/parse-sources.ts for
// why this compares full resolved file URLs rather than basenames.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
```

`todayUTC` is imported for parity with the rest of the CLI's config shape even though it's not called directly here — remove the import if `npm run lint` flags it as unused (`runPipeline`/`runDiscoveryRun` already default `today` themselves).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/run-cli.test.ts && npm run typecheck && npm run lint`
Expected: PASS, no type or lint errors. If lint flags the unused `todayUTC` import, delete that import line.

- [ ] **Step 5: Commit**

```bash
git add scripts/discovery/run.ts tests/discovery/run-cli.test.ts
git commit -m "feat: add the discovery agent's cron entrypoint (scripts/discovery/run.ts)"
```

---

## Task 8: Dockerfile for the VDS cron job

**Files:**
- Create: `Dockerfile.discovery`
- Create: `.dockerignore`
- Modify: `package.json`

**Interfaces:**
- Consumes: `scripts/discovery/run.ts` (Task 7).
- Produces: a buildable image; nothing consumed by later tasks.

- [ ] **Step 1: Add the `discover:run` npm script**

In `package.json`, in `"scripts"`, add a line after `"discover": "tsx scripts/discovery/parse-sources.ts",`:

```json
    "discover:run": "tsx scripts/discovery/run.ts",
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.git
dist
.astro
```

- [ ] **Step 3: Create `Dockerfile.discovery`**

Named `Dockerfile.discovery` (not `Dockerfile`) since it builds the discovery-agent cron job, not the site — the site has no Dockerfile and is unaffected.

```dockerfile
# Runs the discovery agent (docs/discovery-agent.md) as a scheduled batch
# job on the maintainer's VDS. Unrelated to the site itself, which deploys
# as a static Cloudflare Worker — see wrangler.jsonc.
FROM node:26-slim

RUN groupadd --system discovery && \
    useradd --system --gid discovery --create-home discovery

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

USER discovery

CMD ["node_modules/.bin/tsx", "scripts/discovery/run.ts"]
```

- [ ] **Step 4: Verify the image builds**

Run: `docker build -f Dockerfile.discovery -t discovery-agent .`
Expected: build succeeds (no test run inside the image — this just proves the image is constructible; the actual agent needs real credentials to run, which is an operational step, not part of this test suite).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.discovery .dockerignore package.json
git commit -m "feat: add a Dockerfile for the discovery agent's VDS cron job"
```

---

## Task 9: Document deployment in `docs/discovery-agent.md`

**Files:**
- Modify: `docs/discovery-agent.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Add a Deployment section**

Read `docs/discovery-agent.md` first to find the end of its `## Failure handling` section (the last section in the file today), then append a new section after it:

```markdown

## Deployment

The pipeline (`src/lib/discovery/pipeline.ts`), the classifier
(`src/lib/discovery/classify-candidate.ts`) and the PR-opening orchestrator
(`src/lib/discovery/orchestrator.ts`) are composed by
`scripts/discovery/run.ts`, the actual cron entrypoint. `Dockerfile.discovery`
builds it into an image that runs as the unprivileged `discovery` user with
no credentials baked in — everything comes from the environment at
`docker run` time:

```
docker build -f Dockerfile.discovery -t discovery-agent .
docker run --rm --env-file /etc/discovery-agent.env discovery-agent
```

`/etc/discovery-agent.env` (root-only, never in the repo) holds
`LLM_API_KEY`, `LLM_MODEL_EXTRACT`, `STATE_PATH` (a path inside a mounted
volume, so state survives between runs), `GITHUB_TOKEN`, `GITHUB_REPO`, and
optionally `LLM_BASE_URL`, `LLM_MODEL`, `MAX_PAGES`, `MAX_TOKENS`, `MAX_PRS`
— see *Configuration* above for what each does and its default.

Two credentials stay human-only operational steps, per this document's
*Security model*:

- Set a spending cap on the LLM API key in the provider's console before
  the first run.
- Mint `GITHUB_TOKEN` as a fine-grained personal access token scoped to
  this one repository only, with **contents: write** and
  **pull requests: write** — never admin, never merge.

The cron entry itself (e.g. a daily line in the `discovery` user's
crontab running the `docker run` command above) is set up on the VDS by
the maintainer; it is infrastructure outside this repository.
```

- [ ] **Step 2: Verify the doc still reads correctly**

Run: `cat docs/discovery-agent.md | tail -40` and confirm the new section renders as expected — no broken headings, no duplicated content with the existing *Configuration*/*Security model* sections above it.

- [ ] **Step 3: Commit**

```bash
git add docs/discovery-agent.md
git commit -m "docs: document the discovery agent's Docker-based VDS deployment"
```

---

## Final check

- [ ] Run the full suite once more end to end: `npm run lint && npm run typecheck && npm run validate && npm test && npm run build`
- [ ] Confirm `git log --oneline` shows all nine commits from this plan on top of the spec commit.
