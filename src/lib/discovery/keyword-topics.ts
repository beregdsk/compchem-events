import type { Topic } from '../types';

/** schema/event.schema.json's `topics.maxItems`. */
export const MAX_TOPICS = 5;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Topic slugs whose label or slug appears as a phrase in `text`, in
 * vocabulary order, capped at `MAX_TOPICS`. A phrase must not sit inside a
 * longer word, but may run into digits, so "DFT2026" still matches `dft`.
 * No LLM involved — callers fall back to the model when this finds nothing.
 */
export function keywordTopics(text: string, vocabulary: readonly Topic[]): string[] {
  const haystack = normalise(text);
  const found: string[] = [];
  for (const topic of vocabulary) {
    const phrases = new Set([normalise(topic.label), normalise(topic.slug)]);
    const hit = [...phrases].some((phrase) =>
      new RegExp(`(?<![a-z])${escapeRegExp(phrase)}(?![a-z])`).test(haystack),
    );
    if (hit) found.push(topic.slug);
    if (found.length === MAX_TOPICS) break;
  }
  return found;
}
