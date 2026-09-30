// The crawler's scope and link scoring: deterministic, no network, no model.
// Spec: docs/superpowers/specs/2026-09-30-groups-crawler-design.md.
export const MAX_DEPTH = 3;
export const MAX_PAGES_PER_HOST = 40;

const POSITIVE = [
  'group',
  'groups',
  'research',
  'people',
  'faculty',
  'members',
  'lab',
  'labs',
  'theory',
  'theoretical',
  'computational',
  'chemistry',
  'materials',
  'physics',
  'molecular',
];
const NEGATIVE = [
  'news',
  'event',
  'events',
  'login',
  'signin',
  'calendar',
  'publication',
  'publications',
  'shop',
  'admission',
  'admissions',
  'alumni',
];
const FILE = /\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|pptx?|mp4)$/i;

export function seedHostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

export function inScope(url: string, seedHost: string): boolean {
  let host: string;
  try {
    host = seedHostOf(url);
  } catch {
    return false;
  }
  return host === seedHost || host.endsWith(`.${seedHost}`);
}

/** +2 per distinct directory word in the path or link text, −3 per distinct noise word; paging −5, files −10. */
export function linkScore(url: string, text: string): number {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return -10;
  }
  const words = new Set(
    `${u.pathname} ${text}`
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
  let score = 0;
  for (const w of POSITIVE) if (words.has(w)) score += 2;
  for (const w of NEGATIVE) if (words.has(w)) score -= 3;
  if (u.searchParams.has('page') || u.searchParams.has('sort')) score -= 5;
  if (FILE.test(u.pathname)) score -= 10;
  return score;
}

export function priorityOf(score: number, depth: number): number {
  return score - 2 * depth;
}
