import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_QUEUE,
  emptyCrawlState,
  enqueue,
  isFresh,
  loadCrawlState,
  markVisited,
  saveCrawlState,
  takeNext,
  type QueueEntry,
} from '../../../src/lib/discovery/crawl/frontier';

const e = (url: string, priority = 1, depth = 0): QueueEntry => ({
  url,
  priority,
  depth,
  seedHost: new URL(url).hostname,
});

describe('enqueue', () => {
  it('dedupes against the queue, keeping the higher priority', () => {
    const s = emptyCrawlState();
    expect(
      enqueue(
        s,
        [e('https://a.edu/x', 1), e('https://a.edu/x', 5), e('https://a.edu/x', 2)],
        '2026-10-01',
      ),
    ).toBe(2);
    expect(s.queue).toEqual([e('https://a.edu/x', 5)]);
  });

  it('skips a page visited within 180 days, but re-queues a directory after 30 and an error at once', () => {
    const s = emptyCrawlState();
    markVisited(s, 'https://a.edu/neither', 'neither', '2026-06-01');
    markVisited(s, 'https://a.edu/dir', 'directory', '2026-08-15');
    markVisited(s, 'https://a.edu/err', 'error', '2026-09-30');
    enqueue(
      s,
      [e('https://a.edu/neither'), e('https://a.edu/dir'), e('https://a.edu/err')],
      '2026-10-01',
    );
    expect(s.queue.map((q) => q.url)).toEqual(['https://a.edu/dir', 'https://a.edu/err']);
    expect(isFresh(s, 'https://a.edu/neither', '2026-12-01')).toBe(false);
  });

  it('drops the lowest priorities beyond the cap', () => {
    const s = emptyCrawlState();
    const many = Array.from({ length: MAX_QUEUE + 2 }, (_, i) => e(`https://a.edu/${i}`, i));
    enqueue(s, many, '2026-10-01');
    expect(s.queue).toHaveLength(MAX_QUEUE);
    expect(s.queue.some((q) => q.url === 'https://a.edu/0')).toBe(false);
  });
});

describe('takeNext', () => {
  it('takes the best entries on distinct hosts, honouring caps and pauses', () => {
    const s = emptyCrawlState();
    enqueue(
      s,
      [
        e('https://a.edu/1', 9),
        e('https://a.edu/2', 8),
        e('https://b.edu/1', 7),
        e('https://c.edu/1', 6),
        e('https://d.edu/1', 5),
      ],
      '2026-10-01',
    );
    const got = takeNext(s, 3, new Map([['c.edu', 40]]), 40, new Set(['d.edu']));
    expect(got.map((g) => g.url)).toEqual(['https://a.edu/1', 'https://b.edu/1']);
    expect(s.queue.map((q) => q.url).sort()).toEqual([
      'https://a.edu/2',
      'https://c.edu/1',
      'https://d.edu/1',
    ]);
  });
});

describe('load / save', () => {
  it('round-trips atomically and treats a missing or corrupt file as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'crawl-'));
    const path = join(dir, 'crawl-state.json');
    expect(loadCrawlState(path)).toEqual(emptyCrawlState());
    const s = emptyCrawlState();
    enqueue(s, [e('https://a.edu/1')], '2026-10-01');
    markVisited(s, 'https://a.edu/0', 'directory', '2026-10-01');
    saveCrawlState(path, s);
    expect(loadCrawlState(path)).toEqual(s);
    expect(readFileSync(path, 'utf8')).toContain('"version": 1');
    writeFileSync(path, '{not json');
    expect(loadCrawlState(path)).toEqual(emptyCrawlState());
  });
});
