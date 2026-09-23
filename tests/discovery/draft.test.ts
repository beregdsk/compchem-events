import { describe, expect, it } from 'vitest';
import { draftFilePath, slugifyTitle, synthesizeDraft, type DraftInput } from '../../src/lib/discovery/draft';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('DFT Summer School')).toBe('dft-summer-school');
  });

  it('strips accents and punctuation', () => {
    expect(slugifyTitle("École d'Été: DFT & Beyond!")).toBe('ecole-d-ete-dft-beyond');
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugifyTitle('  --Multiple   Spaces--  ')).toBe('multiple-spaces');
  });
});

const fullInput: DraftInput = {
  title: 'New Symposium on Excited-State Photochemistry',
  type: 'symposium',
  start_date: '2027-06-10',
  end_date: '2027-06-12',
  format: 'in-person',
  location: { city: 'Testville', country: 'DE' },
  url: 'https://organiser.example.org/symposium-2027/',
  source_url: 'https://organiser.example.org/symposium-2027/',
  organizer: 'Test Organiser',
  topics: ['photochemistry', 'excited-states'],
  description: 'A symposium on excited-state photochemistry.',
};

describe('synthesizeDraft', () => {
  it('derives id from title and start year, and sets added/last_verified to today', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    expect(draft.id).toBe('new-symposium-on-excited-state-photochemistry-2027');
    expect(draft.added).toBe('2026-09-23');
    expect(draft.last_verified).toBe('2026-09-23');
    expect(draft.location).toEqual({ city: 'Testville', country: 'DE' });
    expect(draft.organizer).toBe('Test Organiser');
  });

  it('omits location and organizer entirely when absent, never as undefined keys', () => {
    const { location, organizer, ...rest } = fullInput;
    void location;
    void organizer;
    const draft = synthesizeDraft(rest, '2026-09-23');
    expect('location' in draft).toBe(false);
    expect('organizer' in draft).toBe(false);
  });
});

describe('draftFilePath', () => {
  it('places the draft under its own start year and id', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    expect(draftFilePath(draft)).toBe(
      'data/events/2027/new-symposium-on-excited-state-photochemistry-2027.yaml',
    );
  });
});

describe('a synthesized draft passes the real validator', () => {
  it('has zero errors against validateEvent with its own draftFilePath', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    const ctx = loadValidationContext('.', '2026-09-23');
    const result = validateEvent({ file: draftFilePath(draft), data: draft }, ctx);
    expect(result.errors).toEqual([]);
  });
});
