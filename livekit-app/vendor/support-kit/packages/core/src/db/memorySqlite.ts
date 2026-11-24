import Database from "better-sqlite3";
import {serializeSqlite} from "./serializedSqlite.js";
import type { DbAdapter } from "../adapters/types.js";

/** In-memory SQLite adapter for tests and local harness. */
export function createMemorySqliteAdapter(): DbAdapter {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  return serializeSqlite(db);
}
