// Monte-Carlo point cloud of a real hydrogenic 3d(z²) orbital.
//
// This is the site's background substrate. It is not decoration standing in for
// chemistry: the dots are samples drawn from |ψ|² by rejection sampling, the
// same construction the poster art it borrows from uses, and the two colours
// the renderer gives them are the two signs of ψ — the phase lobes the palette
// is already named after.
//
// Everything here runs at build time inside an Astro component, so the cost is
// paid once and the browser receives plain markup: no canvas, no runtime JS.
// The PRNG is seeded, so a rebuild reproduces the same cloud and the committed
// output does not churn.

/** Side of the square viewBox the dots are projected into. */
export const FIELD_SIZE = 1000;

/**
 * Density tiers, faintest first. Rejection sampling already places more dots
 * where |ψ|² is large; the tiers additionally draw those dots heavier, which is
 * what gives the cloud a hot core and a dusty fringe instead of a flat spray.
 * `upTo` is a fraction of the peak density.
 */
export const TIERS = [
  { upTo: 0.04, width: 1.3, opacity: 0.45 },
  { upTo: 0.3, width: 1.9, opacity: 0.7 },
  { upTo: Infinity, width: 2.6, opacity: 1 },
] as const;

export interface Dot {
  x: number;
  y: number;
  /** Sign of ψ: +1 for the axial lobes, -1 for the equatorial torus. */
  phase: 1 | -1;
  /** Index into `TIERS`. */
  tier: number;
}

export interface Layer {
  phase: 1 | -1;
  tier: number;
  width: number;
  opacity: number;
  /** SVG path data: one zero-length subpath per dot, drawn with a round cap. */
  d: string;
}

/** Radius of the sampling ball, in Bohr radii. Beyond it |ψ|² is under 0.3% of peak. */
const EXTENT = 20;

/** Tilt of the orbital's z axis towards the viewer, so the torus reads as an ellipse. */
const TILT = 0.35;

/** Seeded so the emitted markup is reproducible across builds. */
const SEED = 0x5ca1ab1e;

/**
 * ψ(3d z²) up to normalisation: R₃₂(r)·Y₂₀(θ) ∝ r² e^(−r/3) (3cos²θ − 1).
 * Returned unnormalised, because sampling only needs ratios.
 */
function amplitude(r: number, cosTheta: number): number {
  return r * r * Math.exp(-r / 3) * (3 * cosTheta * cosTheta - 1);
}

/** |ψ|² at its maximum: on the z axis at r = 6 a₀, where d/dr of r⁴e^(−2r/3) vanishes. */
const PEAK_DENSITY = amplitude(6, 1) ** 2;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `count` samples from |ψ|², projected orthographically onto the viewBox.
 *
 * Rejection sampling in a ball: propose a uniform point, keep it with
 * probability |ψ(point)|²/peak. Acceptance is a few percent, which is
 * irrelevant at build time and keeps the sampler honest — no closed-form
 * shortcut that would quietly distort the shape.
 */
export function sampleOrbital(count: number): Dot[] {
  const random = mulberry32(SEED);
  const scale = FIELD_SIZE / 2 / EXTENT;
  const centre = FIELD_SIZE / 2;
  const dots: Dot[] = [];

  while (dots.length < count) {
    const x = (random() * 2 - 1) * EXTENT;
    const y = (random() * 2 - 1) * EXTENT;
    const z = (random() * 2 - 1) * EXTENT;
    const r = Math.hypot(x, y, z);
    if (r > EXTENT || r === 0) continue;

    const psi = amplitude(r, z / r);
    const density = psi * psi;
    if (random() * PEAK_DENSITY > density) continue;

    // Rotate about the horizontal screen axis, then project. The orbital's z
    // axis stays vertical; the equatorial plane opens up by sin(TILT).
    const depth = z * Math.cos(TILT) + y * Math.sin(TILT);
    dots.push({
      x: round(centre + x * scale),
      y: round(centre - depth * scale),
      phase: psi >= 0 ? 1 : -1,
      tier: TIERS.findIndex((tier) => density / PEAK_DENSITY <= tier.upTo),
    });
  }

  return dots;
}

/**
 * Whole viewBox units. One unit lands under two device pixels at the sizes the
 * field is drawn at, which is below the diameter of the dots themselves, so the
 * quantisation is invisible in a random cloud — and it takes a quarter off the
 * emitted markup.
 */
function round(value: number): number {
  return Math.round(value);
}

/**
 * Group a fresh sample into the paths the renderer draws: one per phase and
 * density tier, so each group can carry its own stroke weight and opacity.
 *
 * Fewer than 2 × `TIERS.length` layers come back, because the tiers are cut
 * against the orbital's global peak and the equatorial torus never reaches it —
 * the axial lobes really are the denser feature. Empty groups are dropped
 * rather than emitted as blank paths.
 */
export function orbitalLayers(count: number): Layer[] {
  const dots = sampleOrbital(count);
  const layers: Layer[] = [];

  for (const phase of [1, -1] as const) {
    for (const [tier, { width, opacity }] of TIERS.entries()) {
      const d = dots
        .filter((dot) => dot.phase === phase && dot.tier === tier)
        // A zero-length subpath with a round linecap renders as a disc of
        // diameter `width`; the explicit (if empty) lineto is what makes every
        // engine agree to draw it, and `h0` is the shortest way to write one.
        .map((dot) => `M${dot.x} ${dot.y}h0`)
        .join('');
      if (d) layers.push({ phase, tier, width, opacity, d });
    }
  }

  return layers;
}
