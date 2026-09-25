import type { RawEvent } from '../types';

const HUMAN_REVIEW_CHECKLIST = `- Opened the official page and confirmed title, dates, location and format.
- Confirmed the organiser and committee are identifiable and the event fits \`docs/curation-policy.md\`.
- Description is in our words and 280 characters or fewer.
- Deadlines match the official page, with the right timezone.
- Topics are sensible and within the vocabulary.
- Set \`last_verified\` to the date you checked, and adjust \`added\` if needed.`;

/**
 * Neutralises backtick runs so candidate-controlled text (extracted from a
 * hostile page — see docs/discovery-agent.md's Security model) can never
 * close the fenced code block it's placed inside and inject markdown of
 * its own into the surrounding, static review checklist.
 */
function sanitizeForCodeBlock(text: string): string {
  return text.replace(/`/g, '´');
}

export interface AddClassification {
  confidence: number;
  criteria: { relevant: number; credible: number; red_flag: number };
}

export function buildPrBody(candidate: RawEvent, classification: AddClassification): string {
  const details = [
    `title: ${candidate.title}`,
    `dates: ${candidate.start_date} to ${candidate.end_date}`,
    `format: ${candidate.format}`,
    `url: ${candidate.url}`,
    `source_url: ${candidate.source_url ?? '(none)'}`,
    `organizer: ${candidate.organizer ?? '(none)'}`,
    `topics: ${candidate.topics.join(', ')}`,
    `description: ${candidate.description}`,
  ]
    .map(sanitizeForCodeBlock)
    .join('\n');

  return [
    `Confidence: ${classification.confidence.toFixed(2)}`,
    `Criteria — relevant: ${classification.criteria.relevant.toFixed(2)}, ` +
      `credible: ${classification.criteria.credible.toFixed(2)}, ` +
      `red_flag: ${classification.criteria.red_flag.toFixed(2)}`,
    '',
    '```',
    details,
    '```',
    '',
    '## Human review checklist',
    '',
    HUMAN_REVIEW_CHECKLIST,
  ].join('\n');
}
