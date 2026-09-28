import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FIELD_SIZE, LEVELS, nodalLines, orbitalLayers } from '../../src/lib/orbital';

function points(d: string): [number, number][] {
  return [...d.matchAll(/(-?\d+) (-?\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

function extent(d: string) {
  const ps = points(d);
  const xs = ps.map(([x]) => x);
  const ys = ps.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe('orbitalLayers', () => {
  const layers = orbitalLayers();

  it('is deterministic, so a rebuild produces an identical diff', () => {
    expect(orbitalLayers()).toEqual(layers);
  });

  it('draws both signs of the wavefunction', () => {
    expect(new Set(layers.map((l) => l.phase))).toEqual(new Set([1, -1]));
  });

  it('emits closed, finite rings in whole viewBox units', () => {
    for (const layer of layers) {
      expect(layer.level).toBeGreaterThanOrEqual(0);
      expect(layer.level).toBeLessThan(LEVELS.length);
      expect(layer.d).toMatch(/^(M-?\d+ -?\d+(L-?\d+ -?\d+)+Z)+$/);
    }
  });

  it('closes every contour inside the frame, so the plate never crops its orbital', () => {
    const margin = FIELD_SIZE * 0.03;
    for (const layer of layers) {
      const box = extent(layer.d);
      expect(box.minX).toBeGreaterThan(margin);
      expect(box.minY).toBeGreaterThan(margin);
      expect(box.maxX).toBeLessThan(FIELD_SIZE - margin);
      expect(box.maxY).toBeLessThan(FIELD_SIZE - margin);
    }
  });

  it('runs the positive lobes along z and the negative torus along x, centred on the origin', () => {
    const mid = FIELD_SIZE / 2;
    for (const layer of layers) {
      const box = extent(layer.d);
      const width = box.maxX - box.minX;
      const height = box.maxY - box.minY;
      if (layer.phase === 1) expect(height).toBeGreaterThan(width);
      else expect(width).toBeGreaterThan(height);
      expect(Math.abs((box.minX + box.maxX) / 2 - mid)).toBeLessThan(2);
      expect(Math.abs((box.minY + box.maxY) / 2 - mid)).toBeLessThan(2);
    }
  });

  it('gives the torus fewer rings than the lobes, since its peak |ψ| is half theirs', () => {
    const count = (phase: 1 | -1) => layers.filter((l) => l.phase === phase).length;
    expect(count(1)).toBe(LEVELS.length);
    expect(count(-1)).toBe(LEVELS.filter((f) => f < 0.5).length);
  });

  it('stays under the point cloud it replaced, which cost about 11 kB gzipped', () => {
    const markup = layers.map((l) => l.d).join('');
    expect(gzipSync(markup).length).toBeLessThan(8_000);
  });
});

describe('nodalLines', () => {
  it('crosses the frame through the centre at the 3d(z²) nodal angle', () => {
    for (const [x1, y1, x2, y2] of nodalLines()) {
      expect(x1).toBe(0);
      expect(x2).toBe(FIELD_SIZE);
      expect((y1 + y2) / 2).toBeCloseTo(FIELD_SIZE / 2, 0);
      // ψ vanishes where 2z² = x², i.e. |z/x| = 1/√2.
      expect(Math.abs(y2 - y1) / FIELD_SIZE).toBeCloseTo(Math.SQRT1_2, 2);
    }
  });
});
