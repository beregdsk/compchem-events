// Contour plot of a real hydrogenic 3d(z²) orbital.
//
// This is the plate in the site's masthead. It is not decoration standing in
// for chemistry: the lines are isovalue contours of ψ on the xz plane, the
// figure a quantum chemistry paper prints for a d orbital, and the two colours
// the renderer gives them are the two signs of ψ — the phase lobes the palette
// is already named after.
//
// Everything here runs at build time inside an Astro component, so the cost is
// paid once and the browser receives plain markup: no canvas, no runtime JS.
// The field is evaluated on a fixed grid with no randomness, so a rebuild
// reproduces the same markup and the committed output does not churn.
import { contours } from 'd3-contour';

/** Side of the square viewBox the plot is drawn into. */
export const FIELD_SIZE = 1000;

/**
 * Half-width of the plot window, in Bohr radii. Wide enough that the faintest
 * contour closes well inside the frame — a plate that clips its own orbital
 * reads as a mistake — and no wider, or the lobes shrink into the middle.
 */
export const WINDOW = 22;

/**
 * Contour levels as fractions of the positive lobe's peak |ψ|, faintest first.
 * Spaced roughly geometrically so the lines crowd towards each lobe's maximum,
 * which is what makes a contour plot read as a hill rather than a target.
 */
export const LEVELS = [0.1, 0.2, 0.34, 0.5, 0.68, 0.86] as const;

/**
 * Grid points per side. At 120 the innermost rings still draw as curves at the
 * plate's size, and the markup is about 7 kB gzipped against 11 kB for the
 * point cloud this replaced.
 */
const GRID = 120;

export interface Layer {
  /** Sign of ψ: +1 for the axial lobes, -1 for the equatorial torus. */
  phase: 1 | -1;
  /** Index into `LEVELS`: 0 is the outermost line. */
  level: number;
  /** SVG path data in viewBox units: closed rings, one subpath each. */
  d: string;
}

/**
 * ψ(3d z²) on the xz plane (y = 0), up to normalisation. With r² = x² + z²,
 * R₃₂(r)·Y₂₀(θ) ∝ r² e^(−r/3) (3cos²θ − 1) = e^(−r/3) (2z² − x²).
 */
function amplitude(x: number, z: number): number {
  return Math.exp(-Math.hypot(x, z) / 3) * (2 * z * z - x * x);
}

/** |ψ| at its maximum: on the z axis at r = 6 a₀, where d/dr of r² e^(−r/3) vanishes. */
const PEAK = amplitude(0, 6);

/**
 * Grid index to Bohr radii, at the centre of the cell d3-contour gives that
 * sample, so the plot and the axis ticks share one scale.
 */
function toBohr(index: number): number {
  return ((index + 0.5) / GRID) * 2 * WINDOW - WINDOW;
}

/**
 * Contour coordinate to viewBox units. d3-contour places sample i on the span
 * [i, i + 1], so its output runs 0…GRID. Rounded to whole units: the plate
 * draws the 1000-unit box at 320 px at most, so a unit is a third of a pixel,
 * and dropping the decimals takes a quarter off the gzipped markup.
 */
function toView(value: number): number {
  return Math.round((value / GRID) * FIELD_SIZE);
}

/**
 * Trace every level for both signs of ψ.
 *
 * The negative torus peaks at half the positive lobes' |ψ| (36 vs 72 e⁻² on the
 * plane), and the levels are cut against the positive peak, so the torus gets
 * fewer rings than the lobes. That is the orbital's real shape, not a styling
 * choice. Levels a sign never reaches are dropped rather than emitted empty.
 */
export function orbitalLayers(): Layer[] {
  const values = new Float64Array(GRID * GRID);
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      // Row 0 is the top of the plot, so z grows upwards.
      values[row * GRID + col] = amplitude(toBohr(col), -toBohr(row)) / PEAK;
    }
  }

  const tracer = contours().size([GRID, GRID]);
  const layers: Layer[] = [];

  for (const phase of [1, -1] as const) {
    const signed = phase === 1 ? values : values.map((v) => -v);
    for (const [level, fraction] of LEVELS.entries()) {
      const { coordinates } = tracer.contour(Array.from(signed), fraction);
      const d = coordinates
        .flat()
        // d3 closes each ring by repeating its first point; `Z` does that already.
        .map(
          (ring) =>
            'M' +
            ring
              .slice(0, -1)
              .map((point) => {
                // GeoJSON positions are typed number[], but d3 always emits pairs.
                const [x, y] = point as [number, number];
                return `${toView(x)} ${toView(y)}`;
              })
              .join('L') +
            'Z',
        )
        .join('');
      if (d) layers.push({ phase, level, d });
    }
  }

  return layers;
}

/**
 * Where the nodal cones of 3d(z²) cut the plane: ψ vanishes where 2z² = x²,
 * two lines through the origin at ±arctan(1/√2) ≈ 35.3° from the x axis.
 * Returned as the endpoints of each line where it leaves the frame.
 */
export function nodalLines(): [number, number, number, number][] {
  const centre = FIELD_SIZE / 2;
  const rise = (centre * Math.SQRT1_2) | 0;
  return [
    [0, centre + rise, FIELD_SIZE, centre - rise],
    [0, centre - rise, FIELD_SIZE, centre + rise],
  ];
}
