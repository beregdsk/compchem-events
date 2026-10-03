/**
 * The slice of Cloudflare's D1 binding this Worker uses. Declared here rather
 * than pulling in @cloudflare/workers-types, whose globals clash with the DOM
 * types the rest of the project is checked against.
 */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
