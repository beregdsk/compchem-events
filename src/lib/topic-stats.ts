// data/topic-stats.json: per-topic literature statistics from OpenAlex,
// written monthly by scripts/topics/snapshot.ts. Spec:
// docs/superpowers/specs/2026-09-30-openalex-topics-design.md; fields in
// docs/topic-stats.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import type { Topic } from './types';
import { formatProblems, loadTopics, type ValidationResult } from './validation';

export const TOPIC_STATS_FILE = 'data/topic-stats.json';

export interface YearCount {
  year: number;
  works: number;
}
export interface InstitutionStat {
  id: string;
  name: string;
  country?: string;
  homepage?: string;
  works: number;
}
export interface VenueStat {
  id: string;
  name: string;
  works: number;
}
export interface PaperStat {
  title: string;
  year: number;
  doi?: string;
  citations: number;
}
export interface SubtopicStat {
  id: string;
  name: string;
  works: number;
  citations: number;
}
export interface SlugStats {
  openalex: string[];
  works_by_year: YearCount[];
  works_total: number;
  growth_5y: number | null;
  citations_total: number;
  top_institutions: InstitutionStat[];
  top_venues: VenueStat[];
  top_papers: PaperStat[];
  subtopics: SubtopicStat[];
}
export interface TopicStats {
  schema_version: 1;
  generated_at: string;
  source: 'OpenAlex';
  topics: Record<string, SlugStats>;
}

let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(readFileSync('schema/topic-stats.schema.json', 'utf8')));
  }
  return compiled;
}

const isHttps = (u: string) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

export function validateTopicStats(
  data: unknown,
  topics: readonly Topic[],
  file = TOPIC_STATS_FILE,
): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };
  const err = (field: string, message: string) => result.errors.push({ file, field, message });
  const validate = schemaValidator();
  if (!validate(data)) {
    for (const e of validate.errors ?? []) err(e.instancePath || '(root)', e.message ?? 'invalid');
    return result;
  }
  const stats = data as TopicStats;
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  for (const [slug, s] of Object.entries(stats.topics)) {
    const topic = bySlug.get(slug);
    if (!topic) {
      err(`topics.${slug}`, 'not a slug in data/topics.yaml');
      continue;
    }
    // A mapping PR may merge before the next snapshot: stale is only a warning.
    const mapped = [...(topic.openalex ?? [])].sort().join(',');
    if (mapped !== [...s.openalex].sort().join(',')) {
      result.warnings.push({
        file,
        field: `topics.${slug}.openalex`,
        message: 'snapshot predates the current mapping; the next monthly snapshot updates it',
      });
    }
    s.top_papers.forEach((p, i) => {
      if (p.doi !== undefined && !isHttps(p.doi)) {
        err(`topics.${slug}.top_papers[${i}].doi`, 'must be an https URL');
      }
    });
    s.top_institutions.forEach((inst, i) => {
      if (inst.homepage !== undefined && !isHttps(inst.homepage)) {
        err(`topics.${slug}.top_institutions[${i}].homepage`, 'must be an https URL');
      }
    });
    const years = s.works_by_year.map((y) => y.year);
    if (years.some((y, i) => i > 0 && y !== years[i - 1]! + 1)) {
      err(`topics.${slug}.works_by_year`, 'years must be consecutive, oldest first');
    }
  }
  return result;
}

/** The committed snapshot, or undefined before the first one. Invalid data fails the build. */
export function loadTopicStats(root = '.'): TopicStats | undefined {
  const path = join(root, TOPIC_STATS_FILE);
  if (!existsSync(path)) return undefined;
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = validateTopicStats(data, loadTopics(root));
  if (result.errors.length > 0) {
    throw new Error(`topic statistics are invalid:\n${formatProblems(result)}`);
  }
  return data as TopicStats;
}
