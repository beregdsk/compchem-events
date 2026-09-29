import { POSITION_LEVEL_LABELS, type RawEvent, type RawPosition } from '../types';
import { isBlocked, normaliseTitle } from '../validation';
import {
  ADD_THRESHOLD,
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
import type { PositionCandidate } from './pipeline';
import { positionFilePath } from './position-draft';

/**
 * Renders candidate-controlled text (extracted from a hostile page — see
 * docs/discovery-agent.md's Security model) as an inline code span, which
 * GitHub wraps like prose but never parses as markdown, HTML, @mentions or
 * #references. Backticks are neutralised so the text can't close its span,
 * and whitespace runs collapse to one space so a blank line can't end the
 * list item and start markdown of its own.
 */
function inlineCode(text: string): string {
  return `\`${text.replace(/`/g, '´').replace(/\s+/g, ' ').trim()}\``;
}

/**
 * A clickable autolink for an https URL. `URL.href` percent-encodes spaces,
 * `<` and `>`, the only characters that could end a CommonMark autolink
 * early; anything that doesn't parse as https falls back to inline code.
 */
function link(url: string | undefined): string {
  if (url === undefined) return '(none)';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return `<${parsed.href}>`;
  } catch {
    // fall through
  }
  return inlineCode(url);
}

export interface AddClassification {
  confidence: number;
  criteria: CriteriaScores;
}

export function buildPrBody(candidate: RawEvent, classification: AddClassification): string {
  const optional = (text: string | undefined) => (text === undefined ? '(none)' : inlineCode(text));
  const details = [
    `- **title:** ${inlineCode(candidate.title)}`,
    `- **dates:** ${inlineCode(`${candidate.start_date} to ${candidate.end_date}`)}`,
    `- **format:** ${inlineCode(candidate.format)}`,
    `- **url:** ${link(candidate.url)}`,
    `- **source_url:** ${link(candidate.source_url)}`,
    `- **organizer:** ${optional(candidate.organizer)}`,
    `- **cost:** ${optional(candidate.cost)}`,
    `- **fee:** ${optional(candidate.fee)}`,
    `- **topics:** ${inlineCode(candidate.topics.join(', '))}`,
    `- **description:** ${inlineCode(candidate.description)}`,
  ];

  const c = classification.criteria;
  return [
    `Confidence: ${classification.confidence.toFixed(2)}`,
    `Criteria — relevant: ${c.relevant.toFixed(2)}, organiser: ${c.organiser.toFixed(2)}, ` +
      `programme: ${c.programme.toFixed(2)}, cost: ${c.cost.toFixed(2)}, ` +
      `red_flag: ${c.red_flag.toFixed(2)}`,
    '',
    ...details,
  ].join('\n');
}

export function buildPositionPrBody(p: RawPosition, confidence: number): string {
  const optional = (text: string | undefined) => (text === undefined ? '(none)' : inlineCode(text));
  return [
    `Confidence: ${confidence.toFixed(2)}`,
    'Position advert (no classifier runs on positions; check it against docs/curation-policy.md).',
    '',
    `- **title:** ${inlineCode(p.title)}`,
    `- **level:** ${inlineCode(POSITION_LEVEL_LABELS[p.level])}`,
    `- **institution:** ${inlineCode(p.institution)}`,
    `- **group:** ${optional(p.group)}`,
    `- **location:** ${inlineCode(`${p.location.city}, ${p.location.country}`)}`,
    `- **deadline:** ${optional(p.deadline)}`,
    `- **url:** ${link(p.url)}`,
    `- **source_url:** ${link(p.source_url)}`,
    `- **topics:** ${inlineCode(p.topics.join(', '))}`,
    `- **description:** ${inlineCode(p.description)}`,
  ].join('\n');
}

/**
 * Mechanical duplicate and blocklist checks for a position, against those on
 * main and those accepted earlier this run. A url equal to its own
 * source_url is the fallback for a post with no advert link, which several
 * positions can share, so only title plus institution identifies those.
 */
export function positionSkipReason(
  p: RawPosition,
  known: readonly RawPosition[],
  blockedHosts: ReadonlySet<string>,
): 'duplicate-url' | 'duplicate-title-institution' | 'blocklisted' | undefined {
  const url = (u: string) => u.replace(/\/+$/, '');
  const key = (x: RawPosition) => `${normaliseTitle(x.title)}|${normaliseTitle(x.institution)}`;
  const ownUrl = p.url !== p.source_url;
  for (const k of known) {
    if (ownUrl && k.url !== k.source_url && url(k.url) === url(p.url)) return 'duplicate-url';
    if (key(k) === key(p)) return 'duplicate-title-institution';
  }
  if (isBlocked(p.url, blockedHosts)) return 'blocklisted';
  if (p.source_url && isBlocked(p.source_url, blockedHosts)) return 'blocklisted';
  return undefined;
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
  /** Position adverts from the pipeline, proposed after events. */
  positions: readonly PositionCandidate[];
  existingPositions: readonly RawPosition[];
  log?: (message: string) => void;
}

export interface OrchestratorResult {
  prsOpened: number;
  prsUpdated: number;
  skipped: Array<{ id: string; reason: string }>;
  /**
   * Ids skipped only because this run's MAX_TOKENS or MAX_PRS ran out —
   * never judged, or judged `add` but never proposed. The caller must hand
   * these back to the pipeline (`PipelineResult.requeue`), or the page or
   * message they came from stays "seen" and they are never retried.
   */
  deferred: string[];
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
  const deferred: string[] = [];
  // Candidates that errored out (GitHub or classification failure) — these
  // are otherwise only ever logged to a cron job's stderr, so they're
  // folded into the same tracking issue as pipeline-level source errors,
  // the one place a human actually sees them.
  const orchestratorErrors: Array<{ source: string; message: string }> = [];

  // Starts as a copy of the events already on main, then grows with every
  // candidate this run itself accepts. Without this, two different sources
  // describing the same real-world event — discovered in the same run, so
  // neither is on main yet when either is classified — each get their own
  // PR: classifyCandidate's mechanical dedupe only ever saw `existingEvents`
  // as it stood at the start of the run. This is what actually happened
  // with PRs #16 and #21 (merged): both opened in the same run, same event,
  // same url, from two different sources.
  const knownEvents: RawEvent[] = [...options.existingEvents];

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

  type Proposal =
    | { outcome: 'opened'; pr: number }
    | { outcome: 'updated'; pr: number }
    | { outcome: 'reviewed' };

  /**
   * Opens or refreshes the PR for one candidate file. Shared by events and
   * positions so both follow the same rules: refresh an open PR, never
   * reopen one a human already closed or merged, and resume a branch whose
   * PR was never opened (a run that crashed in between).
   */
  async function proposeFile(file: {
    branch: string;
    path: string;
    content: string;
    title: string;
    message: string;
    body: string;
    labels: readonly string[];
  }): Promise<Proposal> {
    const status = await getBranchStatus(file.branch, options.github);
    if (status.exists && status.openPr !== undefined) {
      // Refresh content and body, and re-assert the labels in case an
      // earlier run's addLabel call itself failed after opening the PR.
      await putFile(file.branch, file.path, file.content, file.message, options.github);
      await updatePrBody(status.openPr, file.body, options.github);
      for (const label of file.labels) await addLabel(status.openPr, label, options.github);
      return { outcome: 'updated', pr: status.openPr };
    }
    if (status.exists && status.everHadPr) return { outcome: 'reviewed' };
    // Either the branch doesn't exist yet, or it does but no PR was ever
    // opened for it (a prior run crashed between createBranch and openPr) —
    // both resume from here rather than being permanently mistaken for
    // "already reviewed".
    const branchInfo = await ensureDefaultBranch();
    if (!status.exists) await createBranch(file.branch, branchInfo.sha, options.github);
    await putFile(file.branch, file.path, file.content, file.message, options.github);
    const pr = await openPr(file.branch, branchInfo.name, file.title, file.body, options.github);
    for (const label of file.labels) await addLabel(pr.number, label, options.github);
    return { outcome: 'opened', pr: pr.number };
  }

  for (const candidate of options.candidates) {
    try {
      if (tokensUsed >= options.maxTokens) {
        skipped.push({ id: candidate.id, reason: 'MAX_TOKENS reached' });
        deferred.push(candidate.id);
        log(`skipping ${candidate.id}: MAX_TOKENS (${options.maxTokens}) reached`);
        continue;
      }

      const classification = await classifyCandidate(candidate, {
        existingEvents: knownEvents,
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

      // Makes this candidate visible to mechanicalSkip for every candidate
      // still to come in this run — see knownEvents' own comment above.
      // Before any MAX_PRS/GitHub step, so a later duplicate is still
      // caught even if this one itself gets skipped by MAX_PRS.
      knownEvents.push(candidate);

      if (prsOpened + prsUpdated >= options.maxPrs) {
        skipped.push({ id: candidate.id, reason: 'MAX_PRS reached' });
        deferred.push(candidate.id);
        log(`skipping ${candidate.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }

      const proposal = await proposeFile({
        branch: `discovery/${candidate.id}`,
        path: draftFilePath(candidate),
        content: serializeDraft(candidate),
        title: candidate.title,
        message: `Add candidate event: ${candidate.title}`,
        body: buildPrBody(candidate, classification),
        labels: ['needs-review'],
      });
      if (proposal.outcome === 'reviewed') {
        // A PR existed and is now closed or merged — a human already
        // reviewed this candidate. Never reopen it.
        skipped.push({ id: candidate.id, reason: 'already reviewed' });
        log(`skipping ${candidate.id}: branch exists with a closed/merged PR (already reviewed)`);
        continue;
      }
      if (proposal.outcome === 'updated') prsUpdated += 1;
      else prsOpened += 1;
      log(`${proposal.outcome} PR #${proposal.pr} for ${candidate.id}`);
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

  const knownPositions: RawPosition[] = [...options.existingPositions];
  for (const { draft, confidence } of options.positions) {
    try {
      if (confidence < ADD_THRESHOLD) {
        skipped.push({ id: draft.id, reason: 'low confidence' });
        log(`skipping position ${draft.id}: low confidence (${confidence.toFixed(2)})`);
        continue;
      }
      const reason = positionSkipReason(draft, knownPositions, options.blockedHosts);
      if (reason) {
        skipped.push({ id: draft.id, reason });
        log(`skipping position ${draft.id}: ${reason}`);
        continue;
      }
      knownPositions.push(draft);
      if (prsOpened + prsUpdated >= options.maxPrs) {
        skipped.push({ id: draft.id, reason: 'MAX_PRS reached' });
        deferred.push(draft.id);
        log(`skipping position ${draft.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }
      const proposal = await proposeFile({
        branch: `discovery/position/${draft.id}`,
        path: positionFilePath(draft),
        content: serializeDraft(draft),
        title: `Position: ${draft.title}`,
        message: `Add candidate position: ${draft.title}`,
        body: buildPositionPrBody(draft, confidence),
        labels: ['needs-review', 'position'],
      });
      if (proposal.outcome === 'reviewed') {
        skipped.push({ id: draft.id, reason: 'already reviewed' });
        log(
          `skipping position ${draft.id}: branch exists with a closed/merged PR (already reviewed)`,
        );
        continue;
      }
      if (proposal.outcome === 'updated') prsUpdated += 1;
      else prsOpened += 1;
      log(`${proposal.outcome} PR #${proposal.pr} for position ${draft.id}`);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      skipped.push({ id: draft.id, reason: `error: ${messageText}` });
      orchestratorErrors.push({ source: draft.id, message: messageText });
      log(`error processing position ${draft.id}: ${messageText}`);
    }
  }

  await syncFailureIssue([...options.sourceErrors, ...orchestratorErrors], options.github);

  return { prsOpened, prsUpdated, skipped, deferred, tokensUsed };
}
