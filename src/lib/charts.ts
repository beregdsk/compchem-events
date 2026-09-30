// Geometry for the small static charts on /topics/: numbers in, SVG
// coordinates out. No DOM, no dependencies.
export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  label: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Bottom-aligned bars, the tallest reaching `height`; an all-zero series draws flat. */
export function barGeometry(
  series: ReadonlyArray<{ label: string; value: number }>,
  width: number,
  height: number,
  gap = 2,
): { bars: Bar[]; max: number } {
  if (series.length === 0) return { bars: [], max: 0 };
  const max = Math.max(...series.map((s) => s.value));
  const slot = width / series.length;
  const bars = series.map((s, i) => {
    const h = max > 0 ? round((s.value / max) * height) : 0;
    return {
      x: round(i * slot + gap / 2),
      y: round(height - h),
      width: round(slot - gap),
      height: h,
      value: s.value,
      label: s.label,
    };
  });
  return { bars, max };
}

/** `points` for an SVG polyline across `width`, highest value at the top; empty below two points. */
export function sparklinePoints(values: readonly number[], width: number, height: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const y = max === min ? height / 2 : height - ((v - min) / (max - min)) * height;
      return `${round(i * step)},${round(y)}`;
    })
    .join(' ');
}
