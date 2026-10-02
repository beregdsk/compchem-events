import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement } from '../../src/worker/db';

/** D1's binding over an in-memory SQLite, with every migration in `migrations/` applied. */
export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').sort()) {
    raw.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  const statement = (sql: string, values: SQLInputValue[]): D1PreparedStatement => ({
    bind: (...next) => statement(sql, next as SQLInputValue[]),
    first: <T>() => Promise.resolve((raw.prepare(sql).get(...values) as T | undefined) ?? null),
    run: () => Promise.resolve(raw.prepare(sql).run(...values)),
  });
  return { raw, prepare: (sql) => statement(sql, []) };
}
