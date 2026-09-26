import type { RawEvent } from '../types';
import {
  classifyCandidate,
  type ClassificationResult,
  type CriteriaScores,
} from './classify-candidate';
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

/**
 * Neutralises backtick runs so candidate-controlled text (extracted from a
 * hostile page — see docs/discovery-agent.md's Security model) can never
 * close the fenced code block it's placed inside and inject markdown of
 * its own into the rest of the PR body.
 */
function sanitizeForCodeBlock(text: string): string {
  return text.replace(/`/g, '´');
}

export interface AddClassification {
  confidence: number;
  criteria: CriteriaScores;
}

export function buildPrBody(candidate: RawEvent, classification: AddClassification): string {
  const details = [
    `title: ${candidate.title}`,
    `dates: ${candidate.start_date} to ${candidate.end_date}`,
    `format: ${candidate.format}`,
    `url: ${candidate.url}`,
    `source_url: ${candidate.source_url ?? '(none)'}`,
    `organizer: ${candidate.organizer ?? '(none)'}`,
    `cost: ${candidate.cost ?? '(none)'}`,
    `topics: ${candidate.topics.join(', ')}`,
    `description: ${candidate.description}`,
  ]
    .map(sanitizeForCodeBlock)
    .join('\n');

  const c = classification.criteria;
  return [
    `Confidence: ${classification.confidence.toFixed(2)}`,
    `Criteria — relevant: ${c.relevant.toFixed(2)}, organiser: ${c.organiser.toFixed(2)}, ` +
      `programme: ${c.programme.toFixed(2)}, cost: ${c.cost.toFixed(2)}, ` +
      `red_flag: ${c.red_flag.toFixed(2)}`,
    '',
    '```',
    details,
    '```',
  ].join('\n');
}

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
  // Candidates that errored out (GitHub or classification failure) — these
  // are otherwise only ever logged to a cron job's stderr, so they're
  // folded into the same tracking issue as pipeline-level source errors,
  // the one place a human actually sees them.
  const orchestratorErrors: Array<{ source: string; message: string }> = [];

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

      if (status.exists && status.openPr !== undefined) {
        // Refresh content and body, and re-assert the label in case an
        // earlier run's addLabel call itself failed after opening the PR.
        await putFile(branch, path, serializeDraft(candidate), message, options.github);
        await updatePrBody(status.openPr, body, options.github);
        await addLabel(status.openPr, 'needs-review', options.github);
        prsUpdated += 1;
        log(`updated PR #${status.openPr} for ${candidate.id}`);
        continue;
      }

      if (status.exists && status.everHadPr) {
        // A PR existed and is now closed or merged — a human already
        // reviewed this candidate. Never reopen it.
        skipped.push({ id: candidate.id, reason: 'already reviewed' });
        log(`skipping ${candidate.id}: branch exists with a closed/merged PR (already reviewed)`);
        continue;
      }

      // Either the branch doesn't exist yet, or it does but no PR was ever
      // opened for it (a prior run crashed between createBranch and
      // openPr) — both resume from here rather than being permanently
      // mistaken for "already reviewed".
      const branchInfo = await ensureDefaultBranch();
      if (!status.exists) {
        await createBranch(branch, branchInfo.sha, options.github);
      }
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
      orchestratorErrors.push({ source: candidate.id, message: messageText });
      log(`error processing ${candidate.id}: ${messageText}`);
    }
  }

  await syncFailureIssue([...options.sourceErrors, ...orchestratorErrors], options.github);

  return { prsOpened, prsUpdated, skipped, tokensUsed };
}
