import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { resolveTenantFromStore } from "./resolveFromStore.js";
import { TenantStore } from "./store.js";

describe("resolveTenantFromStore", () => {
  let store: TenantStore;

  beforeEach(async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    store = new TenantStore(db);
  });

  it("returns tenantId and brand for a known tenant", async () => {
    const { tenant } = await store.create({
      name: "Acme Corp",
      brand: {
        name: "Acme Help",
        accent: "#112233",
        supportAgentName: "Acme Assist",
      },
    });

    const resolve = resolveTenantFromStore(store);
    const ctx = await resolve({}, tenant.id);

    assert.ok(ctx);
    assert.equal(ctx!.tenantId, tenant.id);
    assert.equal(ctx!.brand.name, "Acme Help");
    assert.equal(ctx!.brand.accentColor, "#112233");
    assert.equal(ctx!.brand.supportAgentName, "Acme Assist");
  });

  it("falls back brand.name to tenant.name when brand name omitted", async () => {
    const { tenant } = await store.create({ name: "Fallback Inc" });
    const ctx = await resolveTenantFromStore(store)({}, tenant.id);
    assert.equal(ctx!.brand.name, "Fallback Inc");
  });

  it("returns null for unknown tenant id", async () => {
    const ctx = await resolveTenantFromStore(store)({}, "00000000-0000-0000-0000-000000000000");
    assert.equal(ctx, null);
  });
});
