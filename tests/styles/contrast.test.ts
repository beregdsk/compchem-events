import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/global.css', 'utf8');

/** Reads a `--name: #rrggbb;` declaration out of the stylesheet. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`token --${name} is missing or is not a 6-digit hex colour`);
  return match[1]!;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('palette contrast', () => {
  it.each([
    ['fg', 'bg', 4.5],
    ['fg-muted', 'bg', 4.5],
    ['fg-muted', 'bg-raise', 4.5],
    ['lobe-neg', 'bg', 4.5],
    ['lobe-pos', 'bg', 4.5],
    ['control', 'bg-raise', 3],
  ] as const)('--%s on --%s meets %s:1', (fg, bg, min) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });

  it('is dark only', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*light/);
  });

  it('routes the semantic aliases to the two lobes', () => {
    expect(css).toMatch(/--link:\s*var\(--lobe-neg\)/);
    expect(css).toMatch(/--time:\s*var\(--lobe-pos\)/);
  });
});
