import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import type { ISODate } from './dates';
import { todayUTC } from './dates';
import type { Topic } from './types';

export interface Problem {
  /** Path of the offending file, relative to the repo root. */
  file: string;
  /** Field path inside the file, e.g. `location/country`. */
  field: string;
  message: string;
}

export interface ValidationResult {
  errors: Problem[];
  warnings: Problem[];
}

export interface ValidationContext {
  topics: ReadonlySet<string>;
  blockedHosts: ReadonlySet<string>;
  today: ISODate;
}

export interface EventFile {
  file: string;
  data: unknown;
}

interface BlocklistEntry {
  domain: string;
}

let compiled: ValidateFunction | undefined;

function schemaValidator(root: string): ValidateFunction {
  if (!compiled) {
    // strictRequired disabled: schema/event.schema.json's allOf/if/then requires
    // `status_note`, a property declared in the parent object's `properties`
    // rather than repeated inside the `then` branch. That is valid JSON Schema,
    // but Ajv's strictRequired check only looks at the local subschema and
    // throws on it. Every other strict-mode check stays enabled.
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    addFormats(ajv);
    compiled = ajv.compile(
      JSON.parse(readFileSync(join(root, 'schema/event.schema.json'), 'utf8')),
    );
  }
  return compiled;
}

export function loadValidationContext(root = '.', today: ISODate = todayUTC()): ValidationContext {
  const topics = parse(readFileSync(join(root, 'data/topics.yaml'), 'utf8')) as Topic[] | null;
  const blocklist = parse(readFileSync(join(root, 'data/blocklist.yaml'), 'utf8')) as
    BlocklistEntry[] | null;
  return {
    topics: new Set((topics ?? []).map((t) => t.slug)),
    blockedHosts: new Set((blocklist ?? []).map((b) => b.domain.toLowerCase())),
    today,
  };
}

// `ctx` is unused until Task 6 adds semantic rules that consult it (topics,
// blocklist). Prefixed to satisfy no-unused-vars in the meantime.
export function validateEvent(entry: EventFile, _ctx: ValidationContext): ValidationResult {
  const result: ValidationResult = { errors: [], warnings: [] };
  const validate = schemaValidator('.');

  if (!validate(entry.data)) {
    for (const err of validate.errors ?? []) {
      const field = err.instancePath.replace(/^\//, '') || err.params?.missingProperty || '(root)';
      result.errors.push({
        file: entry.file,
        field: String(field),
        message: err.message ?? 'schema violation',
      });
    }
    // Semantic rules assume a well-shaped object, so stop here.
    return result;
  }

  // Semantic rules are added in Task 6.
  return result;
}

export function validateCollection(
  _entries: EventFile[],
  _ctx: ValidationContext,
): ValidationResult {
  // Cross-file rules are implemented in Task 6.
  return { errors: [], warnings: [] };
}

export function formatProblems(result: ValidationResult): string {
  const line = (p: Problem, kind: string) => `${kind} ${p.file}: ${p.field}: ${p.message}`;
  return [
    ...result.errors.map((p) => line(p, 'ERROR')),
    ...result.warnings.map((p) => line(p, 'WARN ')),
  ].join('\n');
}
