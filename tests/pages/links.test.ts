import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every `.astro` file under `src/`, recursively. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.astro') ? [path] : [];
  });
}

/** Routes this redesign removed. A link to one of them would 404. */
const REMOVED = /href="\/(deadlines|policy)\/"/;

describe('internal links', () => {
  it('never points at a removed route', () => {
    const offenders = sources('src').filter((f) => REMOVED.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('has no site navigation bar in the layout', () => {
    const layout = readFileSync('src/layouts/Base.astro', 'utf8');
    expect(layout).not.toMatch(/class="site-nav"/);
    expect(layout).not.toMatch(/aria-label="Main"/);
  });
});
