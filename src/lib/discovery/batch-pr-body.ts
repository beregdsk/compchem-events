// The body of a batched registry PR (the backfill and the groups crawler):
// one table row per entry, every candidate-controlled cell as inline code.
import { clip } from './extract-client';
import type { GroupCandidate } from './groups';
import { inlineCode } from './orchestrator';

// GitHub rejects a PR body over 65,536 characters, after the files are already written.
const FOUND_AS_MAX = 80;
const SKIPPED_LISTED = 100;

const CHECK =
  'Check every entry against its website before merging; delete the files of any that are wrong.';
export const BACKFILL_INTRO = `Registry entries backfilled from existing events, positions and group listings.\n${CHECK}`;
export const CRAWL_INTRO = `Registry entries found by the groups crawler on institution and directory pages.\n${CHECK}`;

/** A table cell: inline code with `|` escaped so a hostile value cannot end the cell. */
const cell = (text: string) => inlineCode(text).replace(/\|/g, '\\|');

/**
 * No `Confidence:` line on purpose: auto-approve reads that line, and a batch
 * of many entries must never be flagged as one high-confidence PR.
 */
export function buildBackfillPrBody(
  accepted: readonly GroupCandidate[],
  skipped: ReadonlyArray<{ name: string; reason: string }>,
  notRefound: readonly string[] = [],
  intro: string = BACKFILL_INTRO,
): string {
  const rows = accepted.map((c) =>
    [
      cell(c.draft.id),
      cell(c.draft.name),
      cell(c.draft.kind),
      cell(c.draft.website),
      cell(c.confidence.toFixed(2)),
      cell(clip(c.lead.text, FOUND_AS_MAX)),
    ].join(' | '),
  );
  return [
    intro,
    '',
    '| id | name | kind | website | confidence | found as |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r} |`),
    '',
    `Skipped (${skipped.length}):`,
    ...(skipped.length === 0
      ? ['- (none)']
      : skipped
          .slice(0, SKIPPED_LISTED)
          .map((s) => `- ${cell(clip(s.name, FOUND_AS_MAX))}: ${s.reason}`)),
    ...(skipped.length > SKIPPED_LISTED
      ? [`…and ${skipped.length - SKIPPED_LISTED} more skipped (see the run log)`]
      : []),
    ...(notRefound.length === 0
      ? []
      : [
          '',
          `Written by an earlier run and not found again this time (${notRefound.length}); check or delete:`,
          ...notRefound.map((path) => `- ${cell(path)}`),
        ]),
  ].join('\n');
}
