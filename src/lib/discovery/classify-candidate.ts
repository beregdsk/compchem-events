import { isBlocked, normaliseTitle } from '../validation';
import type { RawEvent } from '../types';
import {
  callJev,
  DEFAULT_JEV_BASE_URL,
  type DecisionsResponse,
  type NoulQuestion,
} from './jev-client';

export type CandidateEvent = Pick<
  RawEvent,
  'title' | 'start_date' | 'end_date' | 'format' | 'url' | 'topics' | 'description'
> &
  Partial<Pick<RawEvent, 'location' | 'source_url' | 'organizer'>>;

export const DEFAULT_JEV_MODEL = '~typesafe/jev-latest';
export const ADD_THRESHOLD = 0.5;
export const FUZZY_TITLE_THRESHOLD = 0.8;

export type MechanicalSkipReason =
  'duplicate-url' | 'duplicate-title-date' | 'duplicate-fuzzy' | 'blocklisted';

export type ClassificationResult =
  | { verdict: 'skip'; mechanicalReason: MechanicalSkipReason }
  | {
      verdict: 'add' | 'skip';
      confidence: number;
      criteria: { relevant: number; credible: number; red_flag: number };
    };

export interface ClassifyOptions {
  existingEvents: readonly RawEvent[];
  blockedHosts: ReadonlySet<string>;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  onUsage?: (tokens: number) => void;
}

function normalisedUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function bigramCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i += 1) {
    const gram = s.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Sørensen-Dice coefficient over character bigrams of the normalised titles.
 * 0 means nothing shared, 1 means identical after normalisation.
 */
export function titleSimilarity(a: string, b: string): number {
  const countsA = bigramCounts(normaliseTitle(a));
  const countsB = bigramCounts(normaliseTitle(b));
  const totalA = [...countsA.values()].reduce((sum, n) => sum + n, 0);
  const totalB = [...countsB.values()].reduce((sum, n) => sum + n, 0);
  if (totalA === 0 || totalB === 0) return totalA === totalB ? 1 : 0;

  let overlap = 0;
  for (const [gram, countA] of countsA) {
    overlap += Math.min(countA, countsB.get(gram) ?? 0);
  }
  return (2 * overlap) / (totalA + totalB);
}

function mechanicalSkip(
  candidate: CandidateEvent,
  existingEvents: readonly RawEvent[],
  blockedHosts: ReadonlySet<string>,
): MechanicalSkipReason | undefined {
  const candidateUrl = normalisedUrl(candidate.url);
  const candidateKey = `${normaliseTitle(candidate.title)}|${candidate.start_date}`;

  for (const existing of existingEvents) {
    if (normalisedUrl(existing.url) === candidateUrl) return 'duplicate-url';
    if (`${normaliseTitle(existing.title)}|${existing.start_date}` === candidateKey) {
      return 'duplicate-title-date';
    }
  }

  for (const existing of existingEvents) {
    if (
      existing.start_date === candidate.start_date &&
      titleSimilarity(candidate.title, existing.title) >= FUZZY_TITLE_THRESHOLD
    ) {
      return 'duplicate-fuzzy';
    }
  }

  if (isBlocked(candidate.url, blockedHosts)) return 'blocklisted';
  if (candidate.source_url && isBlocked(candidate.source_url, blockedHosts)) return 'blocklisted';

  return undefined;
}

const QUESTIONS: Record<'add' | 'relevant' | 'credible' | 'red_flag', NoulQuestion> = {
  add: {
    type: 'noul',
    instructions:
      'Should this candidate event be added to a curated calendar of computational and theoretical chemistry conferences, workshops and schools?',
    criteria: {
      true: "The event fits the calendar's scope, has a credible organiser and programme, and shows no predatory or promotional red flags.",
      false:
        'The event is off-topic, lacks a credible organiser or programme, or shows predatory or promotional red flags.',
    },
  },
  relevant: {
    type: 'noul',
    instructions:
      "Is the event's main subject computational or theoretical chemistry — electronic structure, molecular or materials simulation, machine learning for chemistry and materials, cheminformatics, or computational drug design — or a broader event with a clearly identified computational/theoretical programme?",
    criteria: {
      true: 'Computational or theoretical chemistry is the main subject, or a clearly identified track within a broader event.',
      false:
        'Computational or theoretical chemistry is at most one tag among many unrelated topics, or is absent.',
    },
  },
  credible: {
    type: 'noul',
    instructions:
      'Does the event have an identifiable official organiser or committee, a named scientific programme (invited speakers, a topical scope, or a published call for abstracts), and transparent costs (fees stated or clearly obtainable)?',
    criteria: {
      true: 'A named organiser or committee, a real programme, and clear costs are all present.',
      false:
        'One or more of organiser, programme, or transparent costs is missing or unverifiable.',
    },
  },
  red_flag: {
    type: 'noul',
    instructions:
      'Does the event show signs of unsolicited invitation-style promotion, guaranteed acceptance of all abstracts, pressure to pay quickly, or unverifiable journal or proceedings claims?',
    criteria: {
      true: 'One or more of these predatory or promotional signals is present.',
      false: 'None of these signals are present.',
    },
  },
};

function candidateState(candidate: CandidateEvent): Record<string, unknown> {
  return {
    title: candidate.title,
    start_date: candidate.start_date,
    end_date: candidate.end_date,
    format: candidate.format,
    location: candidate.location,
    url: candidate.url,
    organizer: candidate.organizer,
    topics: candidate.topics,
    description: candidate.description,
  };
}

function requireNoul(response: DecisionsResponse, key: string): number {
  const answer = response.answers[key];
  if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number') {
    throw new Error(`jev response missing a "noul" answer for question "${key}"`);
  }
  return answer.noul;
}

export async function classifyCandidate(
  candidate: CandidateEvent,
  options: ClassifyOptions,
): Promise<ClassificationResult> {
  const mechanicalReason = mechanicalSkip(candidate, options.existingEvents, options.blockedHosts);
  if (mechanicalReason) return { verdict: 'skip', mechanicalReason };

  const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY is required to classify a candidate with jev');
  }

  const response = await callJev(
    {
      model: options.model ?? process.env.LLM_MODEL ?? DEFAULT_JEV_MODEL,
      state: candidateState(candidate),
      questions: QUESTIONS,
    },
    {
      apiKey,
      baseUrl: options.baseUrl ?? process.env.LLM_BASE_URL ?? DEFAULT_JEV_BASE_URL,
      fetchImpl: options.fetchImpl,
    },
  );

  options.onUsage?.(response.usage.input_tokens + response.usage.output_tokens);

  const confidence = requireNoul(response, 'add');
  const criteria = {
    relevant: requireNoul(response, 'relevant'),
    credible: requireNoul(response, 'credible'),
    red_flag: requireNoul(response, 'red_flag'),
  };

  return {
    verdict: confidence >= ADD_THRESHOLD ? 'add' : 'skip',
    confidence,
    criteria,
  };
}
