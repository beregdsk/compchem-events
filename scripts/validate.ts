#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  formatProblems,
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationResult,
} from '../src/lib/validation';

// Re-exported so the discovery agent (docs/discovery-agent.md) can depend on a
// stable entry point, as promised by TASK.md section 7.
export {
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type Problem,
  type ValidationContext,
  type ValidationResult,
} from '../src/lib/validation';

const EVENTS_DIR = 'data/events';

export function readEventFiles(root = '.'): EventFile[] {
  const dir = join(root, EVENTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: `${EVENTS_DIR}/${p.split('\\').join('/')}`,
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

function main(): void {
  const entries = readEventFiles();
  const ctx = loadValidationContext();
  const all: ValidationResult = { errors: [], warnings: [] };

  for (const entry of entries) {
    const r = validateEvent(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  const collection = validateCollection(entries, ctx);
  all.errors.push(...collection.errors);
  all.warnings.push(...collection.warnings);

  const report = formatProblems(all);
  if (report) console.log(report);

  console.log(
    `\nvalidate: ${entries.length} file(s), ${all.errors.length} error(s), ${all.warnings.length} warning(s)`,
  );
  process.exit(all.errors.length > 0 ? 1 : 0);
}

// Only run when invoked directly, so importing this module has no side effects.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main();
}
