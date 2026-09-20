export const REGIONS = [
  'Europe',
  'North America',
  'Latin America',
  'Asia',
  'Middle East',
  'Africa',
  'Oceania',
] as const;

export type Region = (typeof REGIONS)[number];

/** What a page displays. Online events have no country, so they get their own bucket. */
export type DisplayRegion = Region | 'Online';

/**
 * ISO 3166-1 alpha-2 to geographic region.
 *
 * Deliberately not exhaustive over all ~250 codes: it covers the countries that
 * host computational chemistry events. An unlisted country is an error the
 * validator reports, asking the contributor to extend this table, rather than a
 * silent mis-bucketing.
 */
export const COUNTRY_REGIONS: Readonly<Record<string, Region>> = {
  // Europe
  AT: 'Europe',
  BE: 'Europe',
  BG: 'Europe',
  BA: 'Europe',
  BY: 'Europe',
  CH: 'Europe',
  CY: 'Europe',
  CZ: 'Europe',
  DE: 'Europe',
  DK: 'Europe',
  EE: 'Europe',
  ES: 'Europe',
  FI: 'Europe',
  FR: 'Europe',
  GB: 'Europe',
  GR: 'Europe',
  HR: 'Europe',
  HU: 'Europe',
  IE: 'Europe',
  IS: 'Europe',
  IT: 'Europe',
  LT: 'Europe',
  LU: 'Europe',
  LV: 'Europe',
  MT: 'Europe',
  NL: 'Europe',
  NO: 'Europe',
  PL: 'Europe',
  PT: 'Europe',
  RO: 'Europe',
  RS: 'Europe',
  RU: 'Europe',
  SE: 'Europe',
  SI: 'Europe',
  SK: 'Europe',
  UA: 'Europe',

  // North America
  CA: 'North America',
  US: 'North America',

  // Latin America
  AR: 'Latin America',
  BR: 'Latin America',
  CL: 'Latin America',
  CO: 'Latin America',
  CR: 'Latin America',
  CU: 'Latin America',
  EC: 'Latin America',
  MX: 'Latin America',
  PE: 'Latin America',
  UY: 'Latin America',
  VE: 'Latin America',

  // Asia
  CN: 'Asia',
  HK: 'Asia',
  ID: 'Asia',
  IN: 'Asia',
  JP: 'Asia',
  KR: 'Asia',
  MY: 'Asia',
  PH: 'Asia',
  SG: 'Asia',
  TH: 'Asia',
  TW: 'Asia',
  VN: 'Asia',

  // Middle East
  AE: 'Middle East',
  IL: 'Middle East',
  IR: 'Middle East',
  JO: 'Middle East',
  QA: 'Middle East',
  SA: 'Middle East',
  TR: 'Middle East',

  // Africa
  DZ: 'Africa',
  EG: 'Africa',
  ET: 'Africa',
  GH: 'Africa',
  KE: 'Africa',
  MA: 'Africa',
  NG: 'Africa',
  RW: 'Africa',
  SN: 'Africa',
  TN: 'Africa',
  UG: 'Africa',
  ZA: 'Africa',

  // Oceania
  AU: 'Oceania',
  NZ: 'Oceania',
};

/** Geographic region for an ISO alpha-2 code, or undefined if the table lacks it. */
export function regionOf(country: string): Region | undefined {
  return COUNTRY_REGIONS[country];
}
