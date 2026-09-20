import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Regression test for the direct-invocation guard in scripts/validate.ts.
//
// A basename-only comparison (e.g. `import.meta.url.endsWith(basename)`)
// would wrongly run main() whenever a differently-located entry script that
// happens to also be named validate.ts imports this module — exactly the
// shape of the future discovery agent's `import { validateEvent } from
// '../scripts/validate'` (TASK.md section 7). The fixture below reproduces
// that shape: same basename, different directory, imports validateEvent but
// never calls it or main().
describe('scripts/validate.ts direct-invocation guard', () => {
  it('does not run main() when imported from a differently-located validate.ts', () => {
    const fixture = join(process.cwd(), 'tests/fixtures/cli/validate.ts');
    const tsx = join(process.cwd(), 'node_modules/.bin/tsx');

    const result = spawnSync(tsx, [fixture], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('FIXTURE: imported validateEvent, did not call it: function');
    // The CLI summary line is main()'s signature; its absence proves main()
    // did not run as a side effect of the import.
    expect(result.stdout).not.toMatch(/validate: \d+ file\(s\)/);
  });
});
