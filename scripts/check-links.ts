/**
 * Checks that every `url` and `source_url` in the event data actually
 * resolves. Used two ways:
 *
 *   npm run check-links                    every event file — the weekly
 *                                           link-check workflow
 *   npm run check-links -- <files...>      just the given YAML files — the
 *                                           pull-request check on changed
 *                                           files
 *
 * This never fails a build: a dead link is reported, not enforced. Exit code
 * is always 0 unless the check itself cannot run at all (bad input, a file
 * that doesn't parse).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface LinkResult {
  file: string;
  field: 'url' | 'source_url';
  url: string;
  ok: boolean;
  detail: string;
}

const EVENTS_ROOT = 'data/events';
const TIMEOUT_MS = 10_000;

function collectEventFiles(root: string): string[] {
  const files: string[] = [];
  for (const year of readdirSync(root, { withFileTypes: true })) {
    if (!year.isDirectory()) continue;
    const yearDir = join(root, year.name);
    for (const entry of readdirSync(yearDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.yaml')) {
        files.push(join(yearDir, entry.name));
      }
    }
  }
  return files;
}

function extractLinks(file: string): { field: 'url' | 'source_url'; url: string }[] {
  const doc = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const links: { field: 'url' | 'source_url'; url: string }[] = [];
  if (typeof doc.url === 'string') links.push({ field: 'url', url: doc.url });
  if (typeof doc.source_url === 'string') links.push({ field: 'source_url', url: doc.source_url });
  return links;
}

async function checkUrl(url: string): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // HEAD first to avoid downloading full pages; some servers reject HEAD.
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const argFiles = process.argv.slice(2).filter((a) => a !== '--json');
  const asJson = process.argv.includes('--json');
  const files = argFiles.length > 0 ? argFiles : collectEventFiles(EVENTS_ROOT);

  const results: LinkResult[] = [];
  // Dedupe identical URLs so a shared organiser page is only fetched once.
  const seen = new Map<string, { ok: boolean; detail: string }>();

  for (const file of files) {
    for (const { field, url } of extractLinks(file)) {
      let outcome = seen.get(url);
      if (!outcome) {
        outcome = await checkUrl(url);
        seen.set(url, outcome);
      }
      results.push({ file, field, url, ...outcome });
    }
  }

  const dead = results.filter((r) => !r.ok);

  if (asJson) {
    console.log(JSON.stringify({ checked: results.length, dead }, null, 2));
    return;
  }

  if (files.length === 0) {
    console.log('No files to check.');
  } else if (dead.length === 0) {
    console.log(`Checked ${results.length} link(s) across ${files.length} file(s). All resolved.`);
  } else {
    console.log(
      `Checked ${results.length} link(s) across ${files.length} file(s). ${dead.length} did not resolve:\n`,
    );
    for (const d of dead) {
      console.log(`  ${d.file} (${d.field}): ${d.url} — ${d.detail}`);
    }
  }
}

main();
