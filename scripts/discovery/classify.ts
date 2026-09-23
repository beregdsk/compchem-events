#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { loadEvents } from '../../src/lib/events';
import { loadValidationContext } from '../../src/lib/validation';
import { classifyCandidate, type CandidateEvent } from '../../src/lib/discovery/classify-candidate';

export function readCandidate(path: string): CandidateEvent {
  const text = readFileSync(path, 'utf8');
  const data: unknown = path.endsWith('.json') ? JSON.parse(text) : parse(text);
  return data as CandidateEvent;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: classify.ts <candidate.yaml|candidate.json>');
    process.exitCode = 1;
    return;
  }

  const candidate = readCandidate(path);
  const existingEvents = loadEvents();
  const ctx = loadValidationContext();

  const result = await classifyCandidate(candidate, {
    existingEvents,
    blockedHosts: ctx.blockedHosts,
  });

  console.log(JSON.stringify(result, null, 2));
}

// Only run when invoked directly. Compares full resolved file URLs rather
// than basenames — see scripts/validate.ts for why a basename comparison is
// unsafe here too.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
