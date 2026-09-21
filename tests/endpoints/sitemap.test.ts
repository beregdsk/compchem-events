import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_PATHS } from '../../src/pages/sitemap.xml';

/** `/` is served by `index.astro`; `/archive/` by `archive.astro`. Event pages
 * are appended by the route itself from the loader, so only the static list
 * needs a file on disk. */
function pageFile(path: string): string {
  const slug = path.replace(/^\/+|\/+$/g, '');
  return slug === '' ? 'src/pages/index.astro' : `src/pages/${slug}.astro`;
}

describe('sitemap static paths', () => {
  it('advertises only routes that still have a page file', () => {
    expect(STATIC_PATHS.filter((p) => !existsSync(pageFile(p)))).toEqual([]);
  });

  it('starts at the home page', () => {
    expect(STATIC_PATHS[0]).toBe('/');
  });
});
