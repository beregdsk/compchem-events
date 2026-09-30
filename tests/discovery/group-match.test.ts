import { describe, expect, it } from 'vitest';
import {
  buildRegistryIndex,
  isProfileHost,
  leadsFromEvents,
  leadsFromPositions,
  matchName,
  splitOrganizer,
} from '../../src/lib/discovery/group-match';
import type { RawEvent, RawGroup, RawPosition } from '../../src/lib/types';

const cecam: RawGroup = {
  id: 'cecam',
  name: 'Centre Européen de Calcul Atomique et Moléculaire',
  aliases: ['CECAM'],
  kind: 'network',
  website: 'https://www.cecam.org/',
  topics: ['dft'],
  description: 'x',
  added: '2026-09-29',
};
const cosmo: RawGroup = {
  id: 'cosmo-epfl',
  name: 'Laboratory of Computational Science and Modeling',
  kind: 'group',
  pi: 'Michele Ceriotti',
  website: 'https://www.epfl.ch/labs/cosmo/',
  location: { city: 'Lausanne', country: 'CH' },
  topics: ['dft'],
  description: 'x',
  added: '2026-09-29',
};

describe('splitOrganizer', () => {
  it('splits on semicolons and commas and keeps affiliations apart', () => {
    expect(
      splitOrganizer('Stephen Cox (Durham University); Susan Perkin (Oxford University)'),
    ).toEqual([
      { name: 'Stephen Cox', affiliation: 'Durham University' },
      { name: 'Susan Perkin', affiliation: 'Oxford University' },
    ]);
  });

  it('does not split on an ampersand inside a name', () => {
    expect(
      splitOrganizer('CCP5; RSC Statistical Mechanics & Thermodynamics Group').map((p) => p.name),
    ).toEqual(['CCP5', 'RSC Statistical Mechanics & Thermodynamics Group']);
  });

  it('keeps a comma inside parentheses', () => {
    expect(splitOrganizer('Pierre Illien (CNRS, Sorbonne Université)')).toEqual([
      { name: 'Pierre Illien', affiliation: 'CNRS, Sorbonne Université' },
    ]);
  });
});

describe('matchName', () => {
  const index = buildRegistryIndex([cecam, cosmo]);
  it.each([
    ['CECAM', 'cecam'],
    ['cecam', 'cecam'],
    ['Michele Ceriotti', 'cosmo-epfl'],
    ['Centre Europeen de Calcul Atomique et Moleculaire', 'cecam'],
  ])('matches %s', (name, id) => {
    expect(matchName(index, name)).toBe(id);
  });
  it('does not match a part of a name', () => {
    expect(matchName(index, 'CECAM-DE-JUELICH')).toBeUndefined();
  });
});

describe('isProfileHost', () => {
  it.each([
    'https://scholar.google.com.au/citations?user=x',
    'https://www.researchgate.net/profile/x',
    'https://orcid.org/0000',
    'https://x.com/lab',
  ])('flags %s', (u) => expect(isProfileHost(u)).toBe(true));
  it('does not flag a lab site', () => expect(isProfileHost('https://cootelab.com/')).toBe(false));
});

describe('leadsFromEvents / leadsFromPositions', () => {
  it('makes one lead per event organizer, with the event url as origin', () => {
    const e = { organizer: 'CCP5', url: 'https://ccp5.example/agm' } as RawEvent;
    expect(leadsFromEvents([e, { url: 'https://no.example/' } as RawEvent])).toEqual([
      { text: 'CCP5', origin: 'https://ccp5.example/agm', fromListing: false },
    ]);
  });
  it("uses a position's group with the institution as context", () => {
    const p = {
      group: 'Femtochemistry group',
      institution: 'UCM',
      url: 'https://ucm.example/job',
    } as RawPosition;
    expect(leadsFromPositions([p])).toEqual([
      {
        text: 'Femtochemistry group',
        context: 'UCM',
        origin: 'https://ucm.example/job',
        fromListing: false,
      },
    ]);
  });
});
