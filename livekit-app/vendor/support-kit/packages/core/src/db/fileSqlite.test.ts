import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createFileSqliteAdapter } from "./fileSqlite.js";
import { ensureSchema } from "./migrate.js";

describe("createFileSqliteAdapter", () => {
  it("persists rows to a file and reloads them after reopen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-kit-sqlite-"));
    const dbPath = path.join(dir, "support.db");

    const first = createFileSqliteAdapter(dbPath);
    await ensureSchema(first, "support_");
    await first.run(
      `INSERT INTO support_tickets (
        id, tenant_id, public_number, category, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
      ["t-demo", "demo", 1, "support", "2026-08-23T00:00:00.000Z", "2026-08-23T00:00:00.000Z"],
    );
    first.close();

    assert.equal(fs.existsSync(dbPath), true);
    assert.notEqual(fs.statSync(dbPath).size, 0);

    const second = createFileSqliteAdapter(dbPath);
    const row = await second.get<{ tenant_id: string }>(
      `SELECT tenant_id FROM support_tickets WHERE id = ?`,
      ["t-demo"],
    );
    assert.equal(row?.tenant_id, "demo");
    second.close();
  });

  it("rejects :memory: so the harness cannot silently go ephemeral", () => {
    assert.throws(() => createFileSqliteAdapter(":memory:"), /file/i);
  });
});
