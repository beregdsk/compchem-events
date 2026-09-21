import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/global.css', 'utf8');

/** The declarations inside the first rule whose selector line matches. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  if (open === -1 || close === -1) throw new Error(`unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

/** Every `--name: #rrggbb;` declaration in a block, keyed by name. */
function palette(selector: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, hex] of block(selector).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[name!] = hex!;
  }
  return tokens;
}

const DARK = palette(':root {');
const LIGHT = palette(":root[data-theme='light'] {");
const LIGHT_BY_SYSTEM = palette(":root:not([data-theme='dark']) {");

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

/** Foreground, background, minimum ratio. */
const PAIRS = [
  ['fg', 'bg', 4.5],
  ['fg-muted', 'bg', 4.5],
  ['fg-muted', 'bg-raise', 4.5],
  ['lobe-neg', 'bg', 4.5],
  ['lobe-pos', 'bg', 4.5],
  ['control', 'bg-raise', 3],
] as const;

describe.each([
  ['dark', DARK],
  ['light', LIGHT],
])('%s palette contrast', (_theme, tokens) => {
  it.each(PAIRS)('--%s on --%s meets %s:1', (fg, bg, min) => {
    const [a, b] = [tokens[fg], tokens[bg]];
    if (!a || !b) throw new Error(`token --${a ? bg : fg} is missing or is not a 6-digit hex`);
    expect(ratio(a, b)).toBeGreaterThanOrEqual(min);
  });
});

describe('themes', () => {
  it('ships both a dark and a light palette', () => {
    expect(Object.keys(DARK).length).toBeGreaterThan(0);
    expect(Object.keys(LIGHT).length).toBeGreaterThan(0);
  });

  // The light palette has to be declared twice: once for the system preference
  // and once for the reader's explicit choice. Nothing in CSS keeps the copies
  // in step, so this does.
  it('declares the same light values for the system preference and the toggle', () => {
    expect(LIGHT_BY_SYSTEM).toEqual(LIGHT);
  });

  it('repaints every colour token, leaving none inherited from the dark theme', () => {
    const colours = Object.keys(DARK).filter((name) => name !== 'field-opacity');
    expect(Object.keys(LIGHT).sort()).toEqual(colours.sort());
  });

  it('routes the semantic aliases to the two lobes', () => {
    expect(css).toMatch(/--link:\s*var\(--lobe-neg\)/);
    expect(css).toMatch(/--time:\s*var\(--lobe-pos\)/);
  });

  it('lets the reader-chosen theme drive native controls too', () => {
    expect(block(":root[data-theme='light'] {")).toMatch(/color-scheme:\s*light/);
    expect(block(":root[data-theme='dark'] {")).toMatch(/color-scheme:\s*dark/);
  });
});
