import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemorySqliteAdapter } from "./memorySqlite.js";
import { ensureSchema } from "./migrate.js";

describe("ensureSchema", () => {
  it("creates tables and accepts a tenant-scoped insert", async () => {
    const db = createMemorySqliteAdapter();
    const result = await ensureSchema(db, "support_");
    assert.ok(result.statements > 0);

    await db.run(
      `INSERT INTO support_tickets (
        id, tenant_id, public_number, category, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      ["t1", "legalai", 1, "bug", "2026-07-15T00:00:00.000Z", "2026-07-15T00:00:00.000Z"],
    );

    const row = await db.get<{ tenant_id: string }>(
      `SELECT tenant_id FROM support_tickets WHERE id = ?`,
      ["t1"],
    );
    assert.equal(row?.tenant_id, "legalai");
  });

  it("rejects invalid tablePrefix", async () => {
    const db = createMemorySqliteAdapter();
    await assert.rejects(() => ensureSchema(db, "Bad-Prefix!"));
  });
});
