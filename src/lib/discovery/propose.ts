import {
  addLabel,
  createBranch,
  getBranchStatus,
  getDefaultBranch,
  openPr,
  putFile,
  updatePrBody,
  type DefaultBranch,
  type GitHubOptions,
} from './github-client';

export type Proposal =
  | { outcome: 'opened'; pr: number }
  | { outcome: 'updated'; pr: number }
  | { outcome: 'proposed'; pr: number }
  | { outcome: 'reviewed' };

export interface ProposedFile {
  branch: string;
  path: string;
  content: string;
  title: string;
  message: string;
  body: string;
  labels: readonly string[];
  /** false leaves an open PR exactly as it is (see the position loop). */
  refresh?: boolean;
}

export class Proposer {
  // Resolved lazily, on the first proposal that actually needs to create a
  // branch, and memoized after that — never fetched at all for a run where
  // every candidate is skipped or only updates an existing PR, and, just as
  // importantly, called from *inside* the caller's per-candidate try/catch so
  // a failure here is isolated to that one candidate, not the whole run.
  private defaultBranch: DefaultBranch | undefined;

  constructor(private readonly github: GitHubOptions) {}

  private async ensureDefaultBranch(): Promise<DefaultBranch> {
    if (!this.defaultBranch) this.defaultBranch = await getDefaultBranch(this.github);
    return this.defaultBranch;
  }

  /**
   * Opens or refreshes the PR for one candidate file. Shared by events and
   * positions so both follow the same rules: refresh an open PR, never
   * reopen one a human already closed or merged, and resume a branch whose
   * PR was never opened (a run that crashed in between).
   */
  async proposeFile(file: ProposedFile): Promise<Proposal> {
    const status = await getBranchStatus(file.branch, this.github);
    if (status.exists && status.openPr !== undefined && file.refresh === false) {
      return { outcome: 'proposed', pr: status.openPr };
    }
    if (status.exists && status.openPr !== undefined) {
      // Refresh content and body, and re-assert the labels in case an
      // earlier run's addLabel call itself failed after opening the PR.
      await putFile(file.branch, file.path, file.content, file.message, this.github);
      await updatePrBody(status.openPr, file.body, this.github);
      for (const label of file.labels) await addLabel(status.openPr, label, this.github);
      return { outcome: 'updated', pr: status.openPr };
    }
    if (status.exists && status.everHadPr) return { outcome: 'reviewed' };
    // Either the branch doesn't exist yet, or it does but no PR was ever
    // opened for it (a prior run crashed between createBranch and openPr) —
    // both resume from here rather than being permanently mistaken for
    // "already reviewed".
    const branchInfo = await this.ensureDefaultBranch();
    if (!status.exists) await createBranch(file.branch, branchInfo.sha, this.github);
    await putFile(file.branch, file.path, file.content, file.message, this.github);
    const pr = await openPr(file.branch, branchInfo.name, file.title, file.body, this.github);
    for (const label of file.labels) await addLabel(pr.number, label, this.github);
    return { outcome: 'opened', pr: pr.number };
  }
}
