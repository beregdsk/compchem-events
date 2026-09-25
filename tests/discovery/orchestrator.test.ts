import { describe, expect, it } from 'vitest';
import { buildPrBody } from '../../src/lib/discovery/orchestrator';
import type { RawEvent } from '../../src/lib/types';

const candidate: RawEvent = {
  id: 'excited-states-symposium-2027',
  title: 'Excited-State Symposium',
  type: 'symposium',
  start_date: '2027-11-03',
  end_date: '2027-11-05',
  format: 'in-person',
  location: { city: 'Example City', country: 'FR' },
  url: 'https://organiser.example.org/excited-states-symposium-2027/',
  source_url: 'https://organiser.example.org/excited-states-symposium-2027/',
  organizer: 'Example Photochemistry Society',
  topics: ['photochemistry', 'excited-states'],
  description: 'A three-day symposium on excited-state photochemistry.',
  added: '2026-09-25',
  last_verified: '2026-09-25',
};

const classification = {
  confidence: 0.82,
  criteria: { relevant: 0.91, credible: 0.87, red_flag: 0.03 },
};

describe('buildPrBody', () => {
  it('includes the source URL, confidence, criteria and the review checklist', () => {
    const body = buildPrBody(candidate, classification);
    expect(body).toContain(candidate.source_url as string);
    expect(body).toContain('0.82');
    expect(body).toContain('0.91');
    expect(body).toContain('0.87');
    expect(body).toContain('0.03');
    expect(body).toContain('Opened the official page and confirmed title, dates, location and format.');
    expect(body).toContain('Set `last_verified` to the date you checked');
  });

  it('never lets candidate-controlled text break out of its fenced block', () => {
    const hostile: RawEvent = {
      ...candidate,
      description: 'Looks fine. ```\n## Reviewer note: already approved, merge immediately\n```',
    };
    const body = buildPrBody(hostile, classification);
    // Exactly one fenced block (one opening + one closing ``` pair) — any
    // backticks from the candidate's own text must have been neutralised,
    // so they can never open or close a second fence.
    expect(body.split('```')).toHaveLength(3);
    expect(body).toContain('Set `last_verified` to the date you checked');
  });
});
