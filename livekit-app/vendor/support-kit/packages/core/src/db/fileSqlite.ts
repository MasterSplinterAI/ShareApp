import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { DbAdapter } from "../adapters/types.js";

export interface FileSqliteAdapter extends DbAdapter {
  readonly dbPath: string;
  close(): void;
}

/**
 * File-backed SQLite adapter for the local harness (and ShareApp-style hosts).
 * Refuses `:memory:` so a misconfigured SUPPORT_DB cannot silently go ephemeral.
 */
export function createFileSqliteAdapter(dbPath: string): FileSqliteAdapter {
  const trimmed = String(dbPath || "").trim();
  if (!trimmed || trimmed === ":memory:") {
    throw new Error("createFileSqliteAdapter: file path required (refusing :memory:)");
  }

  const resolved = path.resolve(trimmed);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  return {
    dbPath: resolved,
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
    close() {
      db.close();
    },
  };
}
