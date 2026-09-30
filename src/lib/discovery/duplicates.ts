// Likely-duplicate detection for proposed events and positions, against what
// is on main, in open discovery PRs, in PRs closed without merging, and
// accepted earlier in this run. The mechanical skips in classify-candidate.ts
// and positionSkipReason still decide what is dropped outright; this scores
// the rest so a near miss reaches the reviewer flagged, not silently.
import { daysBetween } from '../dates';
import type { RawEvent, RawPosition } from '../types';
import { normaliseTitle } from '../validation';
import { FUZZY_DATE_WINDOW_DAYS } from './classify-candidate';

/** An entry to compare against, and where it lives, for the reviewer. */
export interface KnownDraft<T> {
  entry: T;
  /** e.g. `main`, `#85 (open)`, `#108 (closed without merging)`, `this run`. */
  where: string;
  /** The branch of the open PR it sits in: a candidate never matches the PR it would refresh. */
  branch?: string;
}

export interface DuplicateMatch {
  where: string;
  title: string;
  /** 0 to 1: how likely the two are the same event or position. */
  score: number;
  why: string;
}

/**
 * At or above this, a proposed PR says which entry it may duplicate and is
 * labelled `possible-duplicate` (and so never flagged high-confidence).
 * Calibrated on the events on main on 2026-09-30: of 83, the only pair
 * within the date window above 0.5 was a real duplicate (0.63).
 */
export const POSSIBLE_DUPLICATE_THRESHOLD = 0.6;
export const POSSIBLE_DUPLICATE_LABEL = 'possible-duplicate';

const STOPWORDS = new Set(
  'a an and at de del der des di du el en et for from in la le of on the to und with y'.split(' '),
);

/** Content words, lowercased, with a plural `s` dropped (`Groups` = `Group`). */
function words(text: string): Set<string> {
  return new Set(
    normaliseTitle(text)
      .split(' ')
      .filter((w) => w && !STOPWORDS.has(w))
      .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)),
  );
}

/**
 * Share of the shorter text's content words found in the longer one. Word
 * level, unlike the mechanical skip's character bigrams, which score
 * unrelated titles 0.4–0.55 and "PhD in X" against "Postdoc in X" at 0.9.
 * Needs two shared words, so one common word never counts as a match.
 */
export function wordOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  const shorter = Math.min(wa.size, wb.size);
  if (shorter === 0 || shared < Math.min(2, shorter)) return 0;
  return shared / shorter;
}

const trimUrl = (url: string) => url.replace(/\/+$/, '');

function eventScore(c: RawEvent, k: RawEvent): { score: number; why: string } {
  if (trimUrl(c.url) === trimUrl(k.url)) return { score: 1, why: 'same url' };
  const days = Math.abs(daysBetween(c.start_date, k.start_date));
  if (days > FUZZY_DATE_WINDOW_DAYS) return { score: 0, why: '' };
  const title = wordOverlap(c.title, k.title);
  const when = days === 0 ? 'same start date' : `start dates ${days} day(s) apart`;
  return { score: title, why: `title words ${title.toFixed(2)}, ${when}` };
}

function positionScore(c: RawPosition, k: RawPosition): { score: number; why: string } {
  const ownUrl = (p: RawPosition) => p.url !== p.source_url;
  if (ownUrl(c) && ownUrl(k) && trimUrl(c.url) === trimUrl(k.url)) {
    return { score: 1, why: 'same advert url' };
  }
  const title = wordOverlap(c.title, k.title);
  const institution = wordOverlap(c.institution, k.institution);
  const samePost = c.source_url !== undefined && c.source_url === k.source_url;
  // Different titles at the same institution are usually different posts;
  // the institution only scales the title score, and a shared source post
  // (one Telegram message, one mail) makes the same advert more likely.
  const score = Math.min(1, title * (0.5 + 0.5 * institution) + (samePost ? 0.2 : 0));
  const parts = [`title words ${title.toFixed(2)}`, `institution words ${institution.toFixed(2)}`];
  if (samePost) parts.push('same source post');
  return { score, why: parts.join(', ') };
}

function closest<T>(
  candidate: T,
  known: readonly KnownDraft<T>[],
  score: (c: T, k: T) => { score: number; why: string },
  title: (k: T) => string,
): DuplicateMatch | undefined {
  let best: DuplicateMatch | undefined;
  for (const k of known) {
    const s = score(candidate, k.entry);
    if (s.score > 0 && (!best || s.score > best.score)) {
      best = { where: k.where, title: title(k.entry), score: s.score, why: s.why };
    }
  }
  return best;
}

export function closestEvent(
  c: RawEvent,
  known: readonly KnownDraft<RawEvent>[],
): DuplicateMatch | undefined {
  return closest(c, known, eventScore, (k) => k.title);
}

export function closestPosition(
  c: RawPosition,
  known: readonly KnownDraft<RawPosition>[],
): DuplicateMatch | undefined {
  return closest(c, known, positionScore, (k) => `${k.title} (${k.institution})`);
}
