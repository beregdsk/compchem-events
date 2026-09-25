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
