import { describe, expect, it } from 'vitest';
import { FIELD_SIZE, orbitalLayers, sampleOrbital, TIERS } from '../../src/lib/orbital';

describe('sampleOrbital', () => {
  it('returns the requested number of dots', () => {
    expect(sampleOrbital(300)).toHaveLength(300);
  });

  it('is deterministic, so a rebuild produces an identical diff', () => {
    expect(sampleOrbital(400)).toEqual(sampleOrbital(400));
  });

  it('keeps every dot finite and inside the viewBox', () => {
    for (const dot of sampleOrbital(800)) {
      expect(Number.isFinite(dot.x)).toBe(true);
      expect(Number.isFinite(dot.y)).toBe(true);
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(FIELD_SIZE);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(FIELD_SIZE);
    }
  });

  it('samples both phases of the wavefunction', () => {
    const phases = new Set(sampleOrbital(800).map((d) => d.phase));
    expect(phases).toEqual(new Set([1, -1]));
  });

  it('assigns every dot a defined density tier', () => {
    for (const dot of sampleOrbital(600)) {
      expect(dot.tier).toBeGreaterThanOrEqual(0);
      expect(dot.tier).toBeLessThan(TIERS.length);
    }
  });

  it('puts the positive lobes on the vertical axis and the negative torus around the waist', () => {
    const dots = sampleOrbital(2000);
    const mid = FIELD_SIZE / 2;
    const spread = (phase: 1 | -1) => {
      const of = dots.filter((d) => d.phase === phase);
      return {
        x: of.reduce((s, d) => s + Math.abs(d.x - mid), 0) / of.length,
        y: of.reduce((s, d) => s + Math.abs(d.y - mid), 0) / of.length,
      };
    };
    // The d(z²) lobes run along z (drawn vertically); the torus is equatorial,
    // so it reaches further sideways than up.
    expect(spread(1).y).toBeGreaterThan(spread(1).x);
    expect(spread(-1).x).toBeGreaterThan(spread(-1).y);
  });
});

describe('orbitalLayers', () => {
  it('emits only non-empty layers, each with usable path data', () => {
    const layers = orbitalLayers(900);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.length).toBeLessThanOrEqual(2 * TIERS.length);
    for (const layer of layers) {
      expect(layer.d.startsWith('M')).toBe(true);
      expect(layer.d).not.toMatch(/NaN|Infinity/);
      expect(layer.width).toBeGreaterThan(0);
    }
  });

  it('reserves the densest tier for the axial lobes, which outweigh the torus', () => {
    const top = TIERS.length - 1;
    const phases = orbitalLayers(2000)
      .filter((layer) => layer.tier === top)
      .map((layer) => layer.phase);
    expect(phases).toEqual([1]);
  });

  it('draws every sampled dot exactly once', () => {
    const layers = orbitalLayers(900);
    const drawn = layers.reduce((total, layer) => total + layer.d.split('M').length - 1, 0);
    expect(drawn).toBe(900);
  });

  it('rounds coordinates to whole units so the markup stays small', () => {
    for (const layer of orbitalLayers(500)) {
      expect(layer.d).toMatch(/^(M-?\d+ -?\d+h0)+$/);
    }
  });
});
