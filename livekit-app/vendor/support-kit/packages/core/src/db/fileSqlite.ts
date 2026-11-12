import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {serializeSqlite} from "./serializedSqlite.js";
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

  return {...serializeSqlite(db),dbPath:resolved,close(){db.close();}};
}
