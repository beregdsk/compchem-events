// Keyword rules placing OpenAlex topics under site topics before any model
// call. A rule fires when every pattern matches the topic's name,
// description or keywords. Rules for slugs not in the vocabulary never fire.
export interface CandidateTopic {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  subfield: string;
  works: number;
}

export const MAP_RULES: ReadonlyArray<{ slug: string; all: readonly RegExp[] }> = [
  { slug: 'dft', all: [/density[- ]functional|\bDFT\b/i] },
  {
    slug: 'wavefunction-methods',
    all: [
      /coupled[- ]cluster|configuration interaction|multireference|wave ?function|quantum monte carlo/i,
    ],
  },
  { slug: 'electronic-structure', all: [/electronic structure|ab initio|quantum chemi/i] },
  { slug: 'excited-states', all: [/excited[- ]state|TDDFT|nonadiabatic|non-adiabatic/i] },
  { slug: 'photochemistry', all: [/photochemi|photophysic|photoinduced/i] },
  { slug: 'quantum-dynamics', all: [/quantum dynamics|wavepacket|vibronic/i] },
  { slug: 'molecular-dynamics', all: [/molecular dynamics|force field|molecular simulation/i] },
  {
    slug: 'enhanced-sampling',
    all: [/enhanced sampling|free energy|metadynamics|umbrella sampling|rare event/i],
  },
  {
    slug: 'biomolecular-simulation',
    all: [/protein|biomolecul|membrane|nucleic/i, /simulation|dynamics|modell?ing|computational/i],
  },
  {
    slug: 'soft-matter',
    all: [/soft matter|colloid|polymer physics|liquid crystal|active matter/i],
  },
  {
    slug: 'ml-potentials',
    all: [/machine learning|neural network|deep learning/i, /potential|force field|interatomic/i],
  },
  {
    slug: 'ml-chemistry',
    all: [/machine learning|deep learning|neural network/i, /chemi|molecul|material/i],
  },
  {
    slug: 'cheminformatics',
    all: [/cheminformatic|QSAR|molecular descriptor|virtual screening/i],
  },
  {
    slug: 'drug-design',
    all: [
      /drug (design|discovery)|docking|pharmacophore/i,
      /computational|in silico|docking|virtual/i,
    ],
  },
  {
    slug: 'materials-modeling',
    all: [
      /materials?|solid[- ]state|crystal/i,
      /first[- ]principles|ab initio|DFT|density functional|computational|simulation/i,
    ],
  },
  {
    slug: 'catalysis',
    all: [/catalys/i, /computational|DFT|density functional|theoretical|mechanis/i],
  },
  {
    slug: 'electrochemistry',
    all: [
      /electrochemi|battery|electrolyte|electrocatal/i,
      /computational|DFT|simulation|modell?ing|first[- ]principles/i,
    ],
  },
  {
    slug: 'spectroscopy',
    all: [/spectroscop|spectra/i, /computational|calculation|theoretical|simulation/i],
  },
  {
    slug: 'quantum-computing-chemistry',
    all: [/quantum comput|quantum algorithm|variational quantum/i],
  },
  {
    slug: 'software-hpc',
    all: [/high[- ]performance comput|GPU|parallel comput|scientific software/i],
  },
];

export function ruleSlugs(t: CandidateTopic, slugs: ReadonlySet<string>): string[] {
  const text = [t.name, t.description, ...t.keywords].join(' • ');
  return MAP_RULES.filter((r) => slugs.has(r.slug) && r.all.every((p) => p.test(text))).map(
    (r) => r.slug,
  );
}
