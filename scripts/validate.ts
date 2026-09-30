#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import {
  formatProblems,
  loadValidationContext,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationResult,
} from '../src/lib/validation';
import {
  readPositionFiles,
  validatePosition,
  validatePositionCollection,
} from '../src/lib/position-validation';
import {
  readGroupFiles,
  validateGroup,
  validateGroupCollection,
} from '../src/lib/group-validation';
import { validateSources } from '../src/lib/discovery/sources';
import { validateTopics } from '../src/lib/topic-validation';

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
const SOURCES_FILE = 'data/sources.yaml';

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
  const positions = readPositionFiles();
  for (const entry of positions) {
    const r = validatePosition(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  all.errors.push(...validatePositionCollection(positions).errors);
  const groups = readGroupFiles();
  for (const entry of groups) {
    const r = validateGroup(entry, ctx);
    all.errors.push(...r.errors);
    all.warnings.push(...r.warnings);
  }
  all.errors.push(...validateGroupCollection(groups).errors);
  all.errors.push(...validateSources(parse(readFileSync(SOURCES_FILE, 'utf8')), SOURCES_FILE));

  const topicsResult = validateTopics(parse(readFileSync('data/topics.yaml', 'utf8')));
  all.errors.push(...topicsResult.errors);
  all.warnings.push(...topicsResult.warnings);

  const report = formatProblems(all);
  if (report) console.log(report);

  console.log(
    `\nvalidate: ${entries.length} event file(s), ${positions.length} position file(s), ${groups.length} group file(s), ${all.errors.length} error(s), ${all.warnings.length} warning(s)`,
  );
  process.exit(all.errors.length > 0 ? 1 : 0);
}

// Only run when invoked directly, so importing this module has no side effects.
// Compares full resolved file URLs rather than basenames: a basename-only
// comparison would wrongly run main() when a differently-located entry script
// that happens to also be named validate.ts imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
