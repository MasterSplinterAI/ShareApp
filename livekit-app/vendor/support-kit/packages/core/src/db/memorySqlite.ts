import Database from "better-sqlite3";
import type { DbAdapter } from "../adapters/types.js";

/** In-memory SQLite adapter for tests and local harness. */
export function createMemorySqliteAdapter(): DbAdapter {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  return {
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) as never;
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params) as never;
    },
  };
}
