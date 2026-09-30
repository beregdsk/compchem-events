// Where the crawler starts: our own data, OpenAlex institutions ranked by
// compchem output, and a few web searches. Every seed is re-added each run;
// the frontier ignores those visited recently.
import type { ExtractOptions } from '../extract-client';
import { normalizeEventUrl } from '../extract-client';
import { canBeGroupWebsite } from '../group-match';
import { isPublicHttpsUrl, searchGroupWebsites } from '../group-search';
import type { Source } from '../sources';
import { openAlexGet, stripId, type OpenAlexOptions } from '../../topics/openalex';
import type { RawGroup, RawPosition, Topic } from '../../types';
import type { QueueEntry } from './frontier';
import { seedHostOf } from './score';

export type SeedEntry = QueueEntry;
export const SEED_PRIORITY = {
  registry: 10,
  listing: 10,
  parent: 8,
  position: 6,
  search: 6,
  openalex: 3,
} as const;

/** Job boards and channels whose host is not the advertising institution's. */
const NOT_INSTITUTION =
  /(^|\.)(t\.me|ccl\.net|jobs\.ac\.uk|academicpositions\.com|euraxess\.ec\.europa\.eu|linkedin\.com|indeed\.com|glassdoor\.com|naturecareers\.com|higheredjobs\.com|myworkdayjobs\.com)$/i;
/** The top institutions per topic, and OpenAlex's own limit on ids per OR filter. */
const INSTITUTIONS_PER_TOPIC = 200;
const IDS_PER_REQUEST = 100;
const RECENT_YEARS = 3;

const TEMPLATES = [
  'computational chemistry research groups',
  'theoretical chemistry group',
  'molecular simulation research group',
  'quantum chemistry research group',
] as const;
const COUNTRIES = [
  'United States',
  'Germany',
  'United Kingdom',
  'China',
  'Japan',
  'France',
  'Italy',
  'Spain',
  'Canada',
  'Australia',
  'Switzerland',
  'Netherlands',
  'Sweden',
  'India',
  'South Korea',
  'Brazil',
  'Poland',
  'Denmark',
  'Israel',
  'Singapore',
  'Austria',
  'Belgium',
  'Finland',
  'Norway',
  'Czech Republic',
  'Portugal',
  'Ireland',
  'New Zealand',
  'Mexico',
  'Russia',
] as const;

const entry = (url: string, priority: number): SeedEntry => ({
  url,
  priority,
  depth: 0,
  seedHost: seedHostOf(url),
});

function safeHttps(url: string): string | null {
  const n = normalizeEventUrl(url);
  return n && isPublicHttpsUrl(n) ? n : null;
}

export function parentPaths(url: string): string[] {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    out.push(`${u.origin}/${parts.slice(0, i).join('/')}${i > 0 ? '/' : ''}`);
  }
  return out;
}

export function registrySeeds(groups: readonly Pick<RawGroup, 'website'>[]): SeedEntry[] {
  return groups.flatMap((g) => {
    const url = safeHttps(g.website);
    if (!url) return [];
    return [
      entry(url, SEED_PRIORITY.registry),
      ...parentPaths(url).map((p) => entry(p, SEED_PRIORITY.parent)),
    ];
  });
}

export function positionSeeds(positions: readonly Pick<RawPosition, 'url'>[]): SeedEntry[] {
  return positions.flatMap((p) => {
    const url = safeHttps(p.url);
    if (!url || NOT_INSTITUTION.test(new URL(url).hostname)) return [];
    return [entry(`${new URL(url).origin}/`, SEED_PRIORITY.position)];
  });
}

export function listingSeeds(sources: readonly Source[]): SeedEntry[] {
  return sources.flatMap((s) => {
    if (s.kind !== 'group-listing') return [];
    const url = safeHttps(s.url);
    return url ? [entry(url, SEED_PRIORITY.listing)] : [];
  });
}

export async function openalexSeedUrls(
  topics: readonly Topic[],
  year: number,
  o: OpenAlexOptions,
): Promise<string[]> {
  const works = new Map<string, number>();
  for (const t of topics) {
    if (!t.openalex?.length) continue;
    const res = await openAlexGet<{ group_by: Array<{ key: string; count: number }> }>(
      '/works',
      {
        filter: `topics.id:${t.openalex.join('|')},publication_year:${year - RECENT_YEARS}-${year - 1}`,
        group_by: 'authorships.institutions.id',
        'per-page': String(INSTITUTIONS_PER_TOPIC),
      },
      o,
    );
    for (const g of res.group_by) {
      const id = stripId(g.key);
      if (/^I\d+$/.test(id)) works.set(id, (works.get(id) ?? 0) + g.count);
    }
  }
  const ranked = [...works.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const homepage = new Map<string, string>();
  for (let i = 0; i < ranked.length; i += IDS_PER_REQUEST) {
    const ids = ranked.slice(i, i + IDS_PER_REQUEST);
    const res = await openAlexGet<{ results: Array<{ id: string; homepage_url: string | null }> }>(
      '/institutions',
      {
        filter: `openalex:${ids.join('|')}`,
        select: 'id,homepage_url',
        'per-page': String(IDS_PER_REQUEST),
      },
      o,
    );
    for (const r of res.results) {
      const url = r.homepage_url ? safeHttps(r.homepage_url) : null;
      if (url) homepage.set(stripId(r.id), url);
    }
  }
  return ranked.flatMap((id) => (homepage.has(id) ? [homepage.get(id)!] : []));
}

export function searchQueries(start: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const k = start + i;
    return `${TEMPLATES[k % TEMPLATES.length]} ${COUNTRIES[Math.floor(k / TEMPLATES.length) % COUNTRIES.length]}`;
  });
}

/** Citation URLs become seeds only: what they point to is crawled and classified like anything else. */
export async function searchSeeds(
  queries: readonly string[],
  extract: ExtractOptions,
): Promise<SeedEntry[]> {
  const out: SeedEntry[] = [];
  for (const q of queries) {
    for (const url of await searchGroupWebsites(q, extract)) {
      const safe = safeHttps(url);
      if (safe && canBeGroupWebsite(safe)) out.push(entry(safe, SEED_PRIORITY.search));
    }
  }
  return out;
}
