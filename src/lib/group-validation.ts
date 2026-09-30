// Validation for the groups registry (data/groups/), the third data type
// beside events and positions. Spec:
// docs/superpowers/specs/2026-09-29-groups-registry-design.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import { compareISO } from './dates';
import { regionOf } from './regions';
import type { RawGroup } from './types';
import {
  isBlocked,
  type EventFile,
  type ValidationContext,
  type ValidationResult,
} from './validation';

export const GROUPS_DIR = 'data/groups';

let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    // strictRequired off for the same reason as the event schema: the
    // allOf/if/then requires `location`, declared in the parent object.
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(readFileSync('schema/group.schema.json', 'utf8')));
  }
  return compiled;
}

/** Lowercase, no diacritics or punctuation, single spaces — how names and aliases are compared. */
export function normaliseGroupName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase host without `www.`, plus path without a trailing slash — how websites are compared. */
export function websiteKey(url: string): string {
  const u = new URL(url);
  return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
}

/** Every `<id>.yaml` directly under `dir`, sorted; empty when the folder does not exist yet. */
export function readGroupFiles(dir = GROUPS_DIR): EventFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: join(dir, p).split('\\').join('/'),
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

export function validateGroup(entry: EventFile, ctx: ValidationContext): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const validate = schemaValidator();
  if (!validate(entry.data)) {
    for (const err of validate.errors ?? []) {
      const field = err.instancePath.replace(/^\//, '') || err.params?.missingProperty || '(root)';
      out.errors.push({
        file: entry.file,
        field: String(field),
        message: err.message ?? 'schema violation',
      });
    }
    return out;
  }

  const g = entry.data as RawGroup;
  const err = (field: string, message: string) =>
    out.errors.push({ file: entry.file, field, message });

  const stem = basename(entry.file, '.yaml');
  if (g.id !== stem) err('id', `id "${g.id}" must equal the file name stem "${stem}"`);
  if (compareISO(g.added, ctx.today) > 0) err('added', `added ${g.added} is in the future`);

  for (const t of g.topics) {
    if (!ctx.topics.has(t)) err('topics', `unknown topic "${t}"; add it to data/topics.yaml first`);
  }
  if (g.location && regionOf(g.location.country) === undefined) {
    err(
      'location/country',
      `country "${g.location.country}" is not in the region table; add it to src/lib/regions.ts`,
    );
  }
  for (const field of ['website', 'source_url'] as const) {
    const value = g[field];
    if (value && isBlocked(value, ctx.blockedHosts)) {
      err(field, `host of ${field} is on the blocklist in data/blocklist.yaml`);
    }
  }
  const own = normaliseGroupName(g.name);
  if ((g.aliases ?? []).some((a) => normaliseGroupName(a) === own)) {
    err('aliases', 'an alias must differ from the name');
  }

  if (g.description.length > 200 && !g.description.includes('.')) {
    out.warnings.push({
      file: entry.file,
      field: 'description',
      message: 'description looks copied: over 200 characters with no full stop',
    });
  }
  return out;
}

/** Cross-file checks: no shared id, website, or name/alias. */
export function validateGroupCollection(entries: EventFile[]): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const byId = new Map<string, string>();
  const byWebsite = new Map<string, string>();
  const byName = new Map<string, string>();
  const dup = (
    map: Map<string, string>,
    key: string,
    file: string,
    field: string,
    what: string,
  ) => {
    const seen = map.get(key);
    if (seen && seen !== file)
      out.errors.push({ file, field, message: `duplicate ${what}, also in ${seen}` });
    else map.set(key, file);
  };

  for (const entry of entries) {
    const g = entry.data as RawGroup;
    if (!g || typeof g !== 'object' || typeof g.id !== 'string') continue;
    dup(byId, g.id, entry.file, 'id', 'id');
    try {
      dup(byWebsite, websiteKey(g.website), entry.file, 'website', 'website');
    } catch {
      // A malformed URL is already a schema error.
    }
    for (const name of [g.name, ...(g.aliases ?? [])]) {
      if (typeof name === 'string')
        dup(byName, normaliseGroupName(name), entry.file, 'name', 'name');
    }
  }
  return out;
}
