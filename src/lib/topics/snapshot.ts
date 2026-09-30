// Builds data/topic-stats.json from OpenAlex, one slug at a time, all or
// nothing. Spec: docs/superpowers/specs/2026-09-30-openalex-topics-design.md;
// fields in docs/topic-stats.md.
import type { SlugStats, TopicStats, YearCount } from '../topic-stats';
import type { Topic } from '../types';
import { openAlexGet, stripId, type OpenAlexOptions } from './openalex';

export const TREND_YEARS = 15;
export const RECENT_YEARS = 3;

interface GroupBy {
  group_by: Array<{ key: string; key_display_name: string; count: number }>;
}
interface Meta {
  meta: { count: number };
}
interface InstitutionResult {
  id: string;
  display_name: string;
  country_code: string | null;
  homepage_url: string | null;
}
interface WorkResult {
  title: string | null;
  doi: string | null;
  cited_by_count: number;
  publication_year: number;
}
interface TopicResult {
  id: string;
  display_name: string;
  works_count: number;
  cited_by_count: number;
}

const isHttps = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Last full year over five years before it; null when that base year had no papers. */
export function growth5y(byYear: readonly YearCount[]): number | null {
  if (byYear.length < 6) return null;
  const last = byYear.at(-1)!.works;
  const base = byYear.at(-6)!.works;
  return base > 0 ? Math.round((last / base) * 100) / 100 : null;
}

export async function buildSlugStats(
  ids: readonly string[],
  year: number,
  o: OpenAlexOptions,
): Promise<SlugStats> {
  const F = `topics.id:${ids.join('|')}`;
  const full = `publication_year:${year - TREND_YEARS}-${year - 1}`;
  const recent = `publication_year:${year - RECENT_YEARS}-${year - 1}`;

  const perYear = await openAlexGet<GroupBy>(
    '/works',
    { filter: `${F},${full}`, group_by: 'publication_year' },
    o,
  );
  const counts = new Map(perYear.group_by.map((g) => [Number(g.key), g.count]));
  const works_by_year = Array.from({ length: TREND_YEARS }, (_, i) => {
    const y = year - TREND_YEARS + i;
    return { year: y, works: counts.get(y) ?? 0 };
  });

  const total = await openAlexGet<Meta>('/works', { filter: F, 'per-page': '1' }, o);

  const insts = await openAlexGet<GroupBy>(
    '/works',
    { filter: `${F},${recent}`, group_by: 'authorships.institutions.id' },
    o,
  );
  const topInst = insts.group_by
    .map((g) => ({ id: stripId(g.key), works: g.count }))
    .filter((g) => /^I\d+$/.test(g.id))
    .slice(0, 10);
  const details =
    topInst.length === 0
      ? { results: [] as InstitutionResult[] }
      : await openAlexGet<{ results: InstitutionResult[] }>(
          '/institutions',
          {
            filter: `openalex:${topInst.map((i) => i.id).join('|')}`,
            select: 'id,display_name,country_code,homepage_url',
            'per-page': '50',
          },
          o,
        );
  const byId = new Map(details.results.map((r) => [stripId(r.id), r]));
  const top_institutions = topInst.flatMap((i) => {
    const d = byId.get(i.id);
    if (!d?.display_name) return [];
    return [
      {
        id: i.id,
        name: d.display_name,
        ...(d.country_code && /^[A-Z]{2}$/.test(d.country_code) ? { country: d.country_code } : {}),
        ...(isHttps(d.homepage_url) ? { homepage: d.homepage_url } : {}),
        works: i.works,
      },
    ];
  });

  const venues = await openAlexGet<GroupBy>(
    '/works',
    {
      filter: `${F},${recent},primary_location.source.type:journal`,
      group_by: 'primary_location.source.id',
    },
    o,
  );
  const top_venues = venues.group_by
    .map((g) => ({ id: stripId(g.key), name: g.key_display_name, works: g.count }))
    .filter((v) => /^S\d+$/.test(v.id) && v.name)
    .slice(0, 10);

  const papers = await openAlexGet<{ results: WorkResult[] }>(
    '/works',
    {
      filter: `${F},${recent}`,
      sort: 'cited_by_count:desc',
      'per-page': '5',
      select: 'title,doi,cited_by_count,publication_year',
    },
    o,
  );
  const top_papers = papers.results.flatMap((p) =>
    p.title
      ? [
          {
            title: p.title.slice(0, 500),
            year: p.publication_year,
            ...(isHttps(p.doi) ? { doi: p.doi } : {}),
            citations: p.cited_by_count,
          },
        ]
      : [],
  );

  const topics = await openAlexGet<{ results: TopicResult[] }>(
    '/topics',
    {
      filter: `openalex:${ids.join('|')}`,
      select: 'id,display_name,works_count,cited_by_count',
      'per-page': '50',
    },
    o,
  );
  const subtopics = topics.results
    .map((t) => ({
      id: stripId(t.id),
      name: t.display_name,
      works: t.works_count,
      citations: t.cited_by_count,
    }))
    .sort((a, b) => b.works - a.works);

  return {
    openalex: [...ids],
    works_by_year,
    works_total: total.meta.count,
    growth_5y: growth5y(works_by_year),
    citations_total: subtopics.reduce((sum, t) => sum + t.citations, 0),
    top_institutions,
    top_venues,
    top_papers,
    subtopics,
  };
}

export async function buildSnapshot(
  topics: readonly Topic[],
  today: string,
  o: OpenAlexOptions,
): Promise<TopicStats> {
  const year = Number(today.slice(0, 4));
  const out: TopicStats = {
    schema_version: 1,
    generated_at: today,
    source: 'OpenAlex',
    topics: {},
  };
  for (const t of topics) {
    if (!t.openalex?.length) continue;
    try {
      out.topics[t.slug] = await buildSlugStats(t.openalex, year, o);
    } catch (err) {
      throw new Error(`slug "${t.slug}": ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
  }
  return out;
}

/** Only our own labels and numbers reach the PR body; no OpenAlex text. */
export function buildSnapshotPrBody(
  next: TopicStats,
  previous: TopicStats | undefined,
  labels: ReadonlyMap<string, string>,
): string {
  const rows = Object.entries(next.topics).map(([slug, s]) => {
    const last = s.works_by_year.at(-1)?.works ?? 0;
    const before = previous?.topics[slug]?.works_by_year.at(-1)?.works;
    const change =
      before === undefined ? 'new' : `${last - before >= 0 ? '+' : ''}${last - before}`;
    const growth = s.growth_5y === null ? '—' : `${s.growth_5y.toFixed(2)}×`;
    return `| ${labels.get(slug) ?? slug} | ${last} | ${change} | ${growth} |`;
  });
  return [
    `Monthly topic statistics from OpenAlex (CC0), snapshot of ${next.generated_at}.`,
    '',
    '| Topic | Papers last full year | Change since previous snapshot | Growth over 5 years |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');
}
