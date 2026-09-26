import {
  addLabel,
  getCheckRunConclusions,
  listOpenDiscoveryPrs,
  postReview,
  type GitHubOptions,
} from './github-client';

/** Matches `buildPrBody`'s own `Confidence: 0.93` line — see orchestrator.ts. */
const CONFIDENCE_LINE = /^Confidence: (\d+(?:\.\d+)?)$/m;

export function parseConfidence(prBody: string): number | undefined {
  const match = CONFIDENCE_LINE.exec(prBody);
  if (!match) return undefined;
  return Number(match[1]);
}

export const AUTO_APPROVE_THRESHOLD = 0.9;

/**
 * The checks this pass actually gates on. Deliberately excludes
 * `link-check` (ci.yml runs it as a warning only — `npm run check-links`
 * always exits 0, so it can never fail) and Cloudflare's `Workers Builds`
 * check (a deploy-preview build, not a signal about this candidate's own
 * correctness — see docs/discovery-agent.md for the difference).
 */
export const REQUIRED_CHECKS = ['check', 'e2e'] as const;

export const HIGH_CONFIDENCE_LABEL = 'high-confidence';

export interface AutoApproveResult {
  approved: number[];
  skipped: Array<{ number: number; reason: string }>;
}

/**
 * Flags — never merges, and never formally *approves* — open discovery PRs
 * whose recorded confidence is at least `AUTO_APPROVE_THRESHOLD` and whose
 * `REQUIRED_CHECKS` have all completed successfully: a `high-confidence`
 * label plus a comment-type review explaining why. A maintainer still has
 * to click merge: `docs/curation-policy.md` says an automatically
 * discovered event is never published without human review, and this only
 * fast-tracks finding the PRs ready for that review, never skips it.
 *
 * The review is `event: 'COMMENT'`, not `'APPROVE'` — GitHub rejects an
 * actor formally approving their own PR with HTTP 422, and the same token
 * that runs this opened every discovery PR. A comment is the closest this
 * token is actually allowed to post; see `postReview` in github-client.ts.
 */
export async function autoApproveHighConfidencePrs(
  options: GitHubOptions & { log?: (message: string) => void },
): Promise<AutoApproveResult> {
  const log = options.log ?? (() => {});
  const approved: number[] = [];
  const skipped: Array<{ number: number; reason: string }> = [];

  const prs = await listOpenDiscoveryPrs(options);
  for (const pr of prs) {
    if (pr.labels.includes(HIGH_CONFIDENCE_LABEL)) {
      skipped.push({ number: pr.number, reason: 'already flagged' });
      continue;
    }

    const confidence = parseConfidence(pr.body);
    if (confidence === undefined) {
      skipped.push({ number: pr.number, reason: 'could not parse confidence from PR body' });
      continue;
    }
    if (confidence < AUTO_APPROVE_THRESHOLD) {
      skipped.push({
        number: pr.number,
        reason: `confidence ${confidence.toFixed(2)} below threshold`,
      });
      continue;
    }

    const conclusions = await getCheckRunConclusions(pr.headSha, options);
    const failing = REQUIRED_CHECKS.filter((name) => conclusions.get(name) !== 'success');
    if (failing.length > 0) {
      skipped.push({ number: pr.number, reason: `checks not green: ${failing.join(', ')}` });
      continue;
    }

    await postReview(
      pr.number,
      'COMMENT',
      `High confidence: ${confidence.toFixed(2)} ≥ ${AUTO_APPROVE_THRESHOLD.toFixed(2)}, ` +
        `and ${REQUIRED_CHECKS.join(', ')} all passed. This does not approve or merge the PR — ` +
        "a maintainer's own review and merge are still required (docs/curation-policy.md).",
      options,
    );
    await addLabel(pr.number, HIGH_CONFIDENCE_LABEL, options);
    approved.push(pr.number);
    log(`flagged PR #${pr.number} as high-confidence (${confidence.toFixed(2)})`);
  }

  return { approved, skipped };
}
