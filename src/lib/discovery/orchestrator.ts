import { normaliseGroupName, websiteKey } from '../group-validation';
import { POSITION_LEVEL_LABELS, type RawEvent, type RawGroup, type RawPosition } from '../types';
import { isBlocked, normaliseTitle } from '../validation';
import {
  ADD_THRESHOLD,
  classifyCandidate,
  type ClassificationResult,
  type CriteriaScores,
} from './classify-candidate';
import { draftFilePath, serializeDraft } from './draft';
import {
  closestEvent,
  closestPosition,
  POSSIBLE_DUPLICATE_LABEL,
  POSSIBLE_DUPLICATE_THRESHOLD,
  type DuplicateMatch,
  type KnownDraft,
} from './duplicates';
import { groupFilePath } from './group-draft';
import type { GroupCandidate } from './groups';
import { getBranchStatus, syncFailureIssue, type GitHubOptions } from './github-client';
import type { PositionCandidate } from './pipeline';
import { positionFilePath } from './position-draft';
import type { PrDrafts } from './pr-drafts';
import { Proposer } from './propose';

/**
 * Renders candidate-controlled text (extracted from a hostile page — see
 * docs/discovery-agent.md's Security model) as an inline code span, which
 * GitHub wraps like prose but never parses as markdown, HTML, @mentions or
 * #references. Backticks are neutralised so the text can't close its span,
 * and whitespace runs collapse to one space so a blank line can't end the
 * list item and start markdown of its own.
 */
export function inlineCode(text: string): string {
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

/** The reviewer's warning line; the matched title came from a draft, so it is quoted as code. */
function duplicateLine(dup: DuplicateMatch | undefined): string[] {
  if (!dup || dup.score < POSSIBLE_DUPLICATE_THRESHOLD) return [];
  return [
    `**Possible duplicate** (${dup.score.toFixed(2)}) of ${dup.where}: ${inlineCode(dup.title)} — ${dup.why}`,
  ];
}

const isPossibleDuplicate = (dup: DuplicateMatch | undefined) =>
  dup !== undefined && dup.score >= POSSIBLE_DUPLICATE_THRESHOLD;

export function buildPrBody(
  candidate: RawEvent,
  classification: AddClassification,
  duplicate?: DuplicateMatch,
): string {
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
    ...duplicateLine(duplicate),
    '',
    ...details,
  ].join('\n');
}

export function buildPositionPrBody(
  p: RawPosition,
  confidence: number,
  duplicate?: DuplicateMatch,
): string {
  const optional = (text: string | undefined) => (text === undefined ? '(none)' : inlineCode(text));
  return [
    `Confidence: ${confidence.toFixed(2)}`,
    'Position advert (no classifier runs on positions; check it against docs/curation-policy.md).',
    ...duplicateLine(duplicate),
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

/**
 * Mechanical duplicate and blocklist checks for a proposed group, against
 * the registry and the groups accepted earlier in the same run.
 */
export function groupSkipReason(
  draft: RawGroup,
  known: readonly RawGroup[],
  blockedHosts: ReadonlySet<string>,
): 'duplicate-website' | 'duplicate-name' | 'blocklisted' | undefined {
  if (isBlocked(draft.website, blockedHosts)) return 'blocklisted';
  const site = websiteKey(draft.website);
  const names = new Set([draft.name, ...(draft.aliases ?? [])].map(normaliseGroupName));
  for (const k of known) {
    if (websiteKey(k.website) === site) return 'duplicate-website';
    if ([k.name, ...(k.aliases ?? [])].some((n) => names.has(normaliseGroupName(n)))) {
      return 'duplicate-name';
    }
  }
  return undefined;
}

export function buildGroupPrBody(c: GroupCandidate): string {
  const g = c.draft;
  const optional = (t: string | undefined) => (t === undefined ? '(none)' : inlineCode(t));
  // Laid out like buildPrBody's event PRs; where the name was found, and what
  // was fetched, stay available but folded away.
  return [
    `Confidence: ${c.confidence.toFixed(2)}`,
    '',
    `- **name:** ${inlineCode(g.name)}`,
    `- **kind:** ${inlineCode(g.kind)}`,
    `- **pi:** ${optional(g.pi)}`,
    `- **parent:** ${optional(g.parent)}`,
    `- **website:** ${link(g.website)}`,
    `- **location:** ${g.location ? inlineCode(`${g.location.city}, ${g.location.country}`) : '(none)'}`,
    `- **topics:** ${inlineCode(g.topics.join(', '))}`,
    `- **description:** ${inlineCode(g.description)}`,
    `- **aliases:** ${optional(g.aliases?.join('; '))}`,
    '',
    '<details><summary>How it was found</summary>',
    '',
    `Found as ${inlineCode(c.lead.text)} in ${link(c.lead.origin)}${c.lead.context ? ` (${inlineCode(c.lead.context)})` : ''}.`,
    '',
    'Pages considered:',
    ...c.considered.map((x) => `- ${link(x.url)}: ${inlineCode(x.verdict)}`),
    '',
    '</details>',
  ].join('\n');
}

export interface ProposeGroupsOptions {
  candidates: readonly GroupCandidate[];
  known: readonly RawGroup[];
  blockedHosts: ReadonlySet<string>;
  github: GitHubOptions;
  maxPrs: number;
  log?: (message: string) => void;
}

export interface ProposeGroupsResult {
  prsOpened: number;
  skipped: Array<{ id: string; reason: string }>;
  /** Lookup keys of candidates skipped only because MAX_PRS ran out. */
  deferredKeys: string[];
  errors: Array<{ source: string; message: string }>;
}

export async function proposeGroups(options: ProposeGroupsOptions): Promise<ProposeGroupsResult> {
  const log = options.log ?? (() => {});
  const proposer = new Proposer(options.github);
  const known: RawGroup[] = [...options.known];
  const skipped: ProposeGroupsResult['skipped'] = [];
  const deferredKeys: string[] = [];
  const errors: ProposeGroupsResult['errors'] = [];
  let prsOpened = 0;
  for (const c of options.candidates) {
    const { draft } = c;
    try {
      if (c.confidence < ADD_THRESHOLD) {
        skipped.push({ id: draft.id, reason: 'low confidence' });
        log(`skipping group ${draft.id}: low confidence (${c.confidence.toFixed(2)})`);
        continue;
      }
      const reason = groupSkipReason(draft, known, options.blockedHosts);
      if (reason) {
        skipped.push({ id: draft.id, reason });
        log(`skipping group ${draft.id}: ${reason}`);
        continue;
      }
      // Two drafts in one call can resolve to the same website; only the first may open a PR.
      known.push(draft);
      if (prsOpened >= options.maxPrs) {
        skipped.push({ id: draft.id, reason: 'MAX_PRS reached' });
        deferredKeys.push(c.lookupKey);
        log(`skipping group ${draft.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }
      const proposal = await proposer.proposeFile({
        branch: `discovery/group/${draft.id}`,
        path: groupFilePath(draft),
        content: serializeDraft(draft),
        title: `Group: ${draft.name}`,
        message: `Add candidate group: ${draft.name}`,
        body: buildGroupPrBody(c),
        labels: ['needs-review', 'group'],
        refresh: false,
      });
      if (proposal.outcome === 'proposed') {
        skipped.push({ id: draft.id, reason: 'already proposed' });
        log(`skipping group ${draft.id}: PR #${proposal.pr} is already open`);
        continue;
      }
      if (proposal.outcome === 'reviewed') {
        skipped.push({ id: draft.id, reason: 'already reviewed' });
        log(`skipping group ${draft.id}: branch exists with a closed/merged PR (already reviewed)`);
        continue;
      }
      prsOpened += 1;
      log(`${proposal.outcome} PR #${proposal.pr} for group ${draft.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ id: draft.id, reason: `error: ${message}` });
      errors.push({ source: draft.id, message });
      log(`error processing group ${draft.id}: ${message}`);
    }
  }
  return { prsOpened, skipped, deferredKeys, errors };
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
  /** Drafts in open and rejected discovery PRs, checked for duplicates like those on main. */
  prDrafts?: PrDrafts;
  log?: (message: string) => void;
}

/**
 * A position at or above this duplicate score is skipped outright: the same
 * title at the same institution, or the same advert re-read from one post
 * (PRs #105 and #110 both merged the same Telegram post).
 */
const POSITION_DUPLICATE_SKIP = 0.95;

/** Everything a candidate is compared against, minus the open PR it would itself refresh. */
function othersThan<T>(known: readonly KnownDraft<T>[], branch: string): KnownDraft<T>[] {
  return known.filter((k) => k.branch !== branch);
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
  /** Candidates judged `add`, whether or not a PR opened for them. */
  accepted: RawEvent[];
  tokensUsed: number;
  /** This orchestrator's own per-candidate errors (source: the candidate's id). */
  errors: Array<{ source: string; message: string }>;
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
  // Also every event draft in an open or rejected discovery PR, so a later
  // night's second source is caught too (PRs #53 and #85).
  const knownEvents: KnownDraft<RawEvent>[] = [
    ...options.existingEvents.map((entry) => ({ entry, where: 'main' })),
    ...(options.prDrafts?.events ?? []),
  ];
  const accepted: RawEvent[] = [];

  const proposer = new Proposer(options.github);

  for (const candidate of options.candidates) {
    try {
      if (tokensUsed >= options.maxTokens) {
        skipped.push({ id: candidate.id, reason: 'MAX_TOKENS reached' });
        deferred.push(candidate.id);
        log(`skipping ${candidate.id}: MAX_TOKENS (${options.maxTokens}) reached`);
        continue;
      }

      const branch = `discovery/${candidate.id}`;
      const others = othersThan(knownEvents, branch);
      const classification = await classifyCandidate(candidate, {
        existingEvents: others.map((k) => k.entry),
        blockedHosts: options.blockedHosts,
        apiKey: options.classify.apiKey,
        baseUrl: options.classify.baseUrl,
        model: options.classify.model,
        fetchImpl: options.classify.fetchImpl,
        onUsage: (tokens) => {
          tokensUsed += tokens;
        },
      });

      const duplicate = closestEvent(candidate, others);
      if (classification.verdict !== 'add') {
        const reason = skipReasonFor(classification);
        skipped.push({ id: candidate.id, reason });
        const of = reason.startsWith('duplicate') && duplicate ? ` of ${duplicate.where}` : '';
        log(`skipping ${candidate.id}: ${reason}${of}`);
        continue;
      }

      // Makes this candidate visible to mechanicalSkip for every candidate
      // still to come in this run — see knownEvents' own comment above.
      // Before any MAX_PRS/GitHub step, so a later duplicate is still
      // caught even if this one itself gets skipped by MAX_PRS.
      knownEvents.push({ entry: candidate, where: 'this run' });
      accepted.push(candidate);

      if (prsOpened + prsUpdated >= options.maxPrs) {
        skipped.push({ id: candidate.id, reason: 'MAX_PRS reached' });
        deferred.push(candidate.id);
        log(`skipping ${candidate.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }

      const proposal = await proposer.proposeFile({
        branch,
        path: draftFilePath(candidate),
        content: serializeDraft(candidate),
        title: candidate.title,
        message: `Add candidate event: ${candidate.title}`,
        body: buildPrBody(candidate, classification, duplicate),
        labels: isPossibleDuplicate(duplicate)
          ? ['needs-review', POSSIBLE_DUPLICATE_LABEL]
          : ['needs-review'],
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

  const knownPositions: KnownDraft<RawPosition>[] = [
    ...options.existingPositions.map((entry) => ({ entry, where: 'main' })),
    ...(options.prDrafts?.positions ?? []),
  ];
  for (const { draft, confidence } of options.positions) {
    try {
      if (confidence < ADD_THRESHOLD) {
        skipped.push({ id: draft.id, reason: 'low confidence' });
        log(`skipping position ${draft.id}: low confidence (${confidence.toFixed(2)})`);
        continue;
      }
      const branch = `discovery/position/${draft.id}`;
      const others = othersThan(knownPositions, branch);
      const duplicate = closestPosition(draft, others);
      const reason =
        positionSkipReason(
          draft,
          others.map((k) => k.entry),
          options.blockedHosts,
        ) ??
        (duplicate && duplicate.score >= POSITION_DUPLICATE_SKIP ? 'duplicate-likely' : undefined);
      if (reason) {
        skipped.push({ id: draft.id, reason });
        const of = reason.startsWith('duplicate') && duplicate ? ` of ${duplicate.where}` : '';
        log(`skipping position ${draft.id}: ${reason}${of}`);
        continue;
      }
      knownPositions.push({ entry: draft, where: 'this run' });
      if (prsOpened + prsUpdated >= options.maxPrs) {
        skipped.push({ id: draft.id, reason: 'MAX_PRS reached' });
        deferred.push(draft.id);
        log(`skipping position ${draft.id}: MAX_PRS (${options.maxPrs}) reached`);
        continue;
      }
      // An advert re-seen after 1 January gets a new id (the id carries the
      // year it was added), so last year's branch is checked too.
      const lastYear = `discovery/position/${draft.id.slice(0, -4)}${Number(draft.id.slice(-4)) - 1}`;
      if ((await getBranchStatus(lastYear, options.github)).exists) {
        skipped.push({ id: draft.id, reason: 'already proposed' });
        log(`skipping position ${draft.id}: already proposed on ${lastYear}`);
        continue;
      }
      // refresh: false — a re-sighting must not rewrite an open PR, or its
      // `added` date ("first seen") would move and restart the 45/90-day clock.
      const proposal = await proposer.proposeFile({
        branch,
        path: positionFilePath(draft),
        content: serializeDraft(draft),
        title: `Position: ${draft.title}`,
        message: `Add candidate position: ${draft.title}`,
        body: buildPositionPrBody(draft, confidence, duplicate),
        labels: isPossibleDuplicate(duplicate)
          ? ['needs-review', 'position', POSSIBLE_DUPLICATE_LABEL]
          : ['needs-review', 'position'],
        refresh: false,
      });
      if (proposal.outcome === 'proposed') {
        skipped.push({ id: draft.id, reason: 'already proposed' });
        log(`skipping position ${draft.id}: PR #${proposal.pr} is already open`);
        continue;
      }
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

  return {
    prsOpened,
    prsUpdated,
    skipped,
    deferred,
    accepted,
    tokensUsed,
    errors: orchestratorErrors,
  };
}
