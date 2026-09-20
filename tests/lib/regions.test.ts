import { describe, expect, it } from 'vitest';
import { COUNTRY_REGIONS, REGIONS, regionOf } from '../../src/lib/regions';

describe('regionOf', () => {
  it('maps European codes', () => {
    expect(regionOf('DE')).toBe('Europe');
    expect(regionOf('GB')).toBe('Europe');
    expect(regionOf('CH')).toBe('Europe');
  });

  it('separates North from Latin America', () => {
    expect(regionOf('US')).toBe('North America');
    expect(regionOf('CA')).toBe('North America');
    expect(regionOf('MX')).toBe('Latin America');
    expect(regionOf('BR')).toBe('Latin America');
  });

  it('separates Asia from the Middle East', () => {
    expect(regionOf('JP')).toBe('Asia');
    expect(regionOf('IN')).toBe('Asia');
    expect(regionOf('IL')).toBe('Middle East');
    expect(regionOf('AE')).toBe('Middle East');
  });

  it('covers Africa and Oceania', () => {
    expect(regionOf('ZA')).toBe('Africa');
    expect(regionOf('AU')).toBe('Oceania');
    expect(regionOf('NZ')).toBe('Oceania');
  });

  it('returns undefined for an unknown code so the validator can report it', () => {
    expect(regionOf('ZZ')).toBeUndefined();
  });

  it('does not silently accept lowercase', () => {
    expect(regionOf('de')).toBeUndefined();
  });
});

describe('COUNTRY_REGIONS', () => {
  it('contains only real ISO 3166-1 alpha-2 codes', () => {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (const code of Object.keys(COUNTRY_REGIONS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      // Intl returns the input unchanged when it does not know the region.
      expect(display.of(code)).not.toBe(code);
    }
  });

  it('maps every entry to a declared region', () => {
    for (const region of Object.values(COUNTRY_REGIONS)) {
      expect(REGIONS).toContain(region);
    }
  });
});
