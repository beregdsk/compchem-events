#!/usr/bin/env node
// By hand: propose `openalex` lists for data/topics.yaml as a PR.
// Needs LLM_API_KEY, LLM_MODEL_EXTRACT (or --model <id>), GITHUB_TOKEN and
// GITHUB_REPO; OPENALEX_API_KEY is optional.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { todayUTC } from '../../src/lib/dates';
import { Proposer } from '../../src/lib/discovery/propose';
import { ruleSlugs, type CandidateTopic } from '../../src/lib/topics/map-rules';
import {
  applyMapping,
  buildMapPrBody,
  classifyTopics,
  fetchCandidates,
  formatForRepo,
} from '../../src/lib/topics/propose-map';
import { loadTopics } from '../../src/lib/validation';

const BATCH = 50;

async function main(): Promise<void> {
  const { LLM_API_KEY, GITHUB_TOKEN, GITHUB_REPO } = process.env;
  const modelFlag = process.argv.indexOf('--model');
  const model = modelFlag >= 0 ? process.argv[modelFlag + 1] : process.env.LLM_MODEL_EXTRACT;
  if (!LLM_API_KEY || !model || !GITHUB_TOKEN || !GITHUB_REPO) {
    console.error(
      'LLM_API_KEY, LLM_MODEL_EXTRACT (or --model), GITHUB_TOKEN and GITHUB_REPO are required',
    );
    process.exitCode = 1;
    return;
  }
  const topics = loadTopics();
  const slugs = topics.map((t) => t.slug);
  const vocab = new Set(slugs);
  const candidates = await fetchCandidates({
    mailto: site.contactEmail,
    apiKey: process.env.OPENALEX_API_KEY || undefined,
  });
  console.error(`${candidates.length} candidate OpenAlex topics`);

  const mapping = new Map<string, string[]>(slugs.map((s) => [s, []]));
  const byRule = new Set<string>();
  const rest: CandidateTopic[] = [];
  for (const c of candidates) {
    const hits = ruleSlugs(c, vocab);
    for (const s of hits) {
      mapping.get(s)!.push(c.id);
      byRule.add(`${s}:${c.id}`);
    }
    if (hits.length === 0) rest.push(c);
  }
  const unplaced: CandidateTopic[] = [];
  const extract = { apiKey: LLM_API_KEY, model, topics: slugs };
  for (let i = 0; i < rest.length; i += BATCH) {
    const batch = rest.slice(i, i + BATCH);
    for (const a of await classifyTopics(batch, slugs, extract)) {
      for (const s of a.slugs) mapping.get(s)!.push(a.id);
      if (a.compchem && a.slugs.length === 0) unplaced.push(batch.find((c) => c.id === a.id)!);
    }
    console.error(`classified ${Math.min(i + BATCH, rest.length)}/${rest.length}`);
  }
  unplaced.sort((a, b) => b.works - a.works);

  const today = todayUTC();
  const proposal = await new Proposer({ token: GITHUB_TOKEN, repo: GITHUB_REPO }).proposeFile({
    branch: `data/topic-map-${today}`,
    path: 'data/topics.yaml',
    content: await formatForRepo(
      applyMapping(readFileSync('data/topics.yaml', 'utf8'), mapping),
      'data/topics.yaml',
    ),
    title: 'Topics: map site topics to OpenAlex topics',
    message: 'Map site topics to OpenAlex topics',
    body: buildMapPrBody(topics, mapping, candidates, byRule, unplaced),
    labels: ['data'],
  });
  console.log(JSON.stringify(proposal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
