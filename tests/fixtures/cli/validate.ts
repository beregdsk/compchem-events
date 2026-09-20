// Fixture entry script for tests/cli/validate-guard.test.ts.
// Deliberately named validate.ts (same basename as the real
// scripts/validate.ts) and placed in a different directory, so it reproduces
// the exact condition the direct-invocation guard must handle: a consumer
// that imports validateEvent without ever calling main() itself, as
// TASK.md section 7's future discovery agent will.
import { validateEvent } from '../../../scripts/validate';

console.log('FIXTURE: imported validateEvent, did not call it:', typeof validateEvent);
