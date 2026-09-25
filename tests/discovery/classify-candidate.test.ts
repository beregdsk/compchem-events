import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  ADD_THRESHOLD,
  FUZZY_TITLE_THRESHOLD,
  classifyCandidate,
  titleSimilarity,
  type CandidateEvent,
  type ClassificationResult,
} from '../../src/lib/discovery/classify-candidate';
import type { RawEvent } from '../../src/lib/types';

function loadCandidate(name: string): CandidateEvent {
  return parse(
    readFileSync(`tests/discovery/fixtures/candidates/${name}.yaml`, 'utf8'),
  ) as CandidateEvent;
}

const existingEvents: RawEvent[] = [
  {
    id: 'baseline-conf-2027',
    title: 'Baseline Conference on Molecular Simulation',
    type: 'conference',
    start_date: '2027-04-10',
    end_date: '2027-04-12',
    format: 'in-person',
    location: { city: 'Baseline City', country: 'DE' },
    url: 'https://example.org/baseline-conf-2027/',
    topics: ['molecular-dynamics'],
    description: 'The baseline event already on the calendar.',
    added: '2026-09-20',
    last_verified: '2026-09-20',
  },
];

const blockedHosts = new Set(['predatory-example.com']);

function stubFetch(payload: unknown) {
  const calls: Array<{ init: RequestInit }> = [];
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init: init ?? {} });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const cleanResponse = {
  model: 'typesafe/jev-1.13-test',
  answers: {
    add: { type: 'noul', noul: 0.82 },
    relevant: { type: 'noul', noul: 0.91 },
    credible: { type: 'noul', noul: 0.87 },
    red_flag: { type: 'noul', noul: 0.03 },
  },
  usage: { input_tokens: 400, output_tokens: 0, cost: 0.0000168 },
};

describe('titleSimilarity', () => {
  it('is 1 for identical titles', () => {
    expect(titleSimilarity('DFT Summer School', 'DFT Summer School')).toBe(1);
  });

  it('is high for a near-duplicate title', () => {
    expect(
      titleSimilarity(
        'Baseline Conference on Molecular Simulation',
        'The Baseline Conference on Molecular Simulations',
      ),
    ).toBeGreaterThanOrEqual(FUZZY_TITLE_THRESHOLD);
  });

  it('is low for unrelated titles', () => {
    expect(
      titleSimilarity(
        'Baseline Conference on Molecular Simulation',
        'New Symposium on Excited-State Photochemistry',
      ),
    ).toBeLessThan(FUZZY_TITLE_THRESHOLD);
  });
});

describe('classifyCandidate — mechanical pre-filter', () => {
  it('skips an exact URL duplicate without calling jev', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    const result = await classifyCandidate(loadCandidate('duplicate-url'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result).toEqual({ verdict: 'skip', mechanicalReason: 'duplicate-url' });
    expect(calls).toHaveLength(0);
  });

  it('skips a title+date duplicate without calling jev', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    const result = await classifyCandidate(loadCandidate('duplicate-title-date'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result).toEqual({ verdict: 'skip', mechanicalReason: 'duplicate-title-date' });
    expect(calls).toHaveLength(0);
  });

  it('skips a fuzzy title duplicate on the same date without calling jev', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    const result = await classifyCandidate(loadCandidate('duplicate-fuzzy'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result).toEqual({ verdict: 'skip', mechanicalReason: 'duplicate-fuzzy' });
    expect(calls).toHaveLength(0);
  });

  it('skips a blocklisted domain without calling jev', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    const result = await classifyCandidate(loadCandidate('blocklisted'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result).toEqual({ verdict: 'skip', mechanicalReason: 'blocklisted' });
    expect(calls).toHaveLength(0);
  });
});

describe('classifyCandidate — jev verdict', () => {
  it('returns an add verdict with the confidence and criteria from jev', async () => {
    const { impl } = stubFetch(cleanResponse);
    const result = await classifyCandidate(loadCandidate('clean-add'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result).toEqual({
      verdict: 'add',
      confidence: 0.82,
      criteria: { relevant: 0.91, credible: 0.87, red_flag: 0.03 },
    });
  });

  it('reports combined input+output token usage via onUsage', async () => {
    const { impl } = stubFetch(cleanResponse);
    const usages: number[] = [];
    await classifyCandidate(loadCandidate('clean-add'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(usages).toEqual([400]);
  });

  it('does not call onUsage on a mechanical skip', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    const usages: number[] = [];
    await classifyCandidate(loadCandidate('duplicate-url'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(calls).toHaveLength(0);
    expect(usages).toEqual([]);
  });

  it('returns a skip verdict when confidence is below the threshold', async () => {
    const lowResponse = {
      ...cleanResponse,
      answers: { ...cleanResponse.answers, add: { type: 'noul', noul: 0.2 } },
    };
    const { impl } = stubFetch(lowResponse);
    const result = await classifyCandidate(loadCandidate('clean-add'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });
    expect(result.verdict).toBe('skip');
    expect((result as Extract<ClassificationResult, { confidence: number }>).confidence).toBe(0.2);
    expect(ADD_THRESHOLD).toBe(0.5);
  });

  it('throws when LLM_API_KEY is not set and no apiKey option is given', async () => {
    const original = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      await expect(
        classifyCandidate(loadCandidate('clean-add'), { existingEvents, blockedHosts }),
      ).rejects.toThrow(/LLM_API_KEY/);
    } finally {
      if (original !== undefined) process.env.LLM_API_KEY = original;
    }
  });

  it('only ever puts candidate content in state, never in instructions or criteria', async () => {
    const { impl, calls } = stubFetch(cleanResponse);
    await classifyCandidate(loadCandidate('adversarial'), {
      existingEvents,
      blockedHosts,
      apiKey: 'sk-test',
      fetchImpl: impl,
    });

    const body = JSON.parse(calls[0]!.init.body as string) as {
      state: { description: string };
      questions: Record<
        string,
        { instructions: string; criteria: { true: string; false: string } }
      >;
    };
    const candidateText = loadCandidate('adversarial').description;

    expect(body.state.description).toBe(candidateText);
    for (const question of Object.values(body.questions)) {
      expect(question.instructions).not.toContain(candidateText);
      expect(question.criteria.true).not.toContain(candidateText);
      expect(question.criteria.false).not.toContain(candidateText);
    }
  });
});
