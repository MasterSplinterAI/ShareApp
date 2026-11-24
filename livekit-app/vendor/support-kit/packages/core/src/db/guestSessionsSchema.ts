import type { DbAdapter } from "../adapters/types.js";

/** Included in explicit boot migrations as well as lazy guest routes. */
export async function ensureGuestSessionsSchema(db: DbAdapter, prefix: string): Promise<void> {
    await db.run(`CREATE TABLE IF NOT EXISTS ${prefix}guest_sessions (
      token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      email TEXT NOT NULL, name TEXT, expires_at TEXT NOT NULL
    )`);
    // Deliberately strict: central ownership must not run with a partially applied schema.
    await db.all(`SELECT token_hash, tenant_id, owner_id, email, name, expires_at FROM ${prefix}guest_sessions LIMIT 0`);
}
