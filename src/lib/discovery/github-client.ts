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
  const response = await fetchImpl(
    `${options.baseUrl ?? GITHUB_API}/repos/${options.repo}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
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

export type BranchStatus =
  { exists: false } | { exists: true; openPr: number | undefined; everHadPr: boolean };

interface PullSummary {
  number: number;
  state: string;
}

/**
 * `everHadPr` distinguishes an orphaned branch (created by a prior run that
 * then crashed before `openPr` — resumable) from a branch whose PR is now
 * closed or merged (a human already reviewed it — never reopen). Both have
 * `openPr: undefined`; only querying `state=all` instead of `state=open`
 * tells them apart.
 */
export async function getBranchStatus(
  branch: string,
  options: GitHubOptions,
): Promise<BranchStatus> {
  const refRes = await githubRequest<unknown>(options, 'GET', `/git/ref/heads/${branch}`);
  if (refRes.status === 404) return { exists: false };
  if (refRes.status !== 200) {
    throw new Error(`failed to check branch "${branch}": HTTP ${refRes.status}`);
  }
  const owner = options.repo.split('/')[0];
  const pullsRes = await githubRequest<PullSummary[]>(
    options,
    'GET',
    `/pulls?state=all&head=${owner}:${branch}`,
  );
  if (pullsRes.status !== 200) {
    throw new Error(`failed to list pull requests for branch "${branch}": HTTP ${pullsRes.status}`);
  }
  const openPr = pullsRes.data.find((pr) => pr.state === 'open')?.number;
  return { exists: true, openPr, everHadPr: pullsRes.data.length > 0 };
}

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
  content?: string;
}

/**
 * Skips the commit entirely when the branch already has this exact content
 * at this path — otherwise a rerun that re-extracts an unchanged candidate
 * would commit an identical file every time and reset `added`/
 * `last_verified` over whatever a reviewer already edited on the PR (final
 * review finding I4). GitHub's Contents API returns `content` base64-
 * encoded with embedded newlines every ~60 characters, hence the strip
 * before decoding.
 */
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
  if (
    existing.status === 200 &&
    typeof existing.data.content === 'string' &&
    Buffer.from(existing.data.content.replace(/\s/g, ''), 'base64').toString('utf8') === content
  ) {
    return;
  }
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
