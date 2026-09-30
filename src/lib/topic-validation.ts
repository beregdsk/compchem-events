// Checks data/topics.yaml: slugs, labels and the optional `openalex` lists.
// Spec: docs/superpowers/specs/2026-09-30-openalex-topics-design.md.
import type { ValidationResult } from './validation';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TOPIC_ID = /^T\d+$/;

export function validateTopics(data: unknown, file = 'data/topics.yaml'): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };
  const err = (field: string, message: string) => result.errors.push({ file, field, message });
  if (!Array.isArray(data)) {
    err('(root)', 'must be a list of topics');
    return result;
  }
  const slugs = new Set<string>();
  const ownerOf = new Map<string, string>();
  for (const entry of data as Array<Record<string, unknown>>) {
    const slug = typeof entry?.slug === 'string' ? entry.slug : '(missing slug)';
    if (slugs.has(slug)) err(`${slug}.slug`, 'repeated slug');
    slugs.add(slug);
    if (!SLUG.test(slug)) err(`${slug}.slug`, 'must be lowercase words joined by hyphens');
    if (typeof entry?.label !== 'string' || entry.label.trim() === '') {
      err(`${slug}.label`, 'required');
    }
    if (entry?.openalex === undefined) continue;
    if (!Array.isArray(entry.openalex)) {
      err(`${slug}.openalex`, 'must be a list of OpenAlex topic ids');
      continue;
    }
    const seen = new Set<string>();
    for (const id of entry.openalex as unknown[]) {
      if (typeof id !== 'string' || !TOPIC_ID.test(id)) {
        err(
          `${slug}.openalex`,
          `"${String(id)}" is not an OpenAlex topic id (T followed by digits)`,
        );
        continue;
      }
      if (seen.has(id)) err(`${slug}.openalex`, `"${id}" is listed twice`);
      seen.add(id);
      const owner = ownerOf.get(id);
      if (owner && owner !== slug) {
        result.warnings.push({
          file,
          field: `${slug}.openalex`,
          message: `"${id}" is also mapped under "${owner}"`,
        });
      } else ownerOf.set(id, slug);
    }
  }
  return result;
}
