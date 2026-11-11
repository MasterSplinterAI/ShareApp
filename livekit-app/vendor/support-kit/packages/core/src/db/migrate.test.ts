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

it("upgrades a populated legacy tenant table additively and idempotently", async () => {
  const db=createMemorySqliteAdapter();
  await db.run("CREATE TABLE support_tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, ingest_token_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  await db.run("INSERT INTO support_tenants VALUES ('old','Original',NULL,'existing-hash','then','then')");
  await ensureSchema(db); await ensureSchema(db);
  const {TenantStore}=await import("../tenants/store.js");
  const store=new TenantStore(db);
  await store.update("old",{brand:{name:"New brand"}});
  const row=await db.get<{name:string;brand_json:string;ingest_token_hash:string}>("SELECT * FROM support_tenants WHERE id='old'");
  assert.equal(row?.name,"Original"); assert.equal(row?.ingest_token_hash,"existing-hash"); assert.equal(JSON.parse(row!.brand_json).name,"New brand");
});
