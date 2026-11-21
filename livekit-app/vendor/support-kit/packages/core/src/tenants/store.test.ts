import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { TenantStore } from "./store.js";

describe("TenantStore", () => {
  let store: TenantStore;

  beforeEach(async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    store = new TenantStore(db);
  });

  it("creates, lists, gets, updates, and deletes a tenant", async () => {
    const { tenant, ingestToken } = await store.create({
      name: "Acme Corp",
      domain: "acme.co",
    });

    assert.ok(tenant.id);
    assert.equal(tenant.name, "Acme Corp");
    assert.equal(tenant.domain, "acme.co");
    assert.ok(ingestToken.startsWith("sk_live_"));
    assert.equal(tenant.brand?.name, "Acme Corp");

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, tenant.id);

    const fetched = await store.getById(tenant.id);
    assert.equal(fetched?.name, "Acme Corp");

    const updated = await store.update(tenant.id, { name: "Acme Industries" });
    assert.equal(updated.name, "Acme Industries");
    assert.equal(updated.brand?.name, "Acme Industries");

    const removed = await store.remove(tenant.id);
    assert.equal(removed, true);
    assert.equal(await store.getById(tenant.id), undefined);
  });

  it("persists brand_json on create and update", async () => {
    const { tenant } = await store.create({
      name: "Widget Co",
      brand: {
        name: "Widget Support",
        accent: "#ff6600",
        supportAgentName: "Widget Bot",
        signupUrl: "/signup",
        contactEmail: "help@widget.co",
      },
    });

    assert.equal(tenant.brand?.name, "Widget Support");
    assert.equal(tenant.brand?.accent, "#ff6600");
    assert.equal(tenant.brand?.supportAgentName, "Widget Bot");

    const refetched = await store.getById(tenant.id);
    assert.equal(refetched?.brand?.accent, "#ff6600");

    const patched = await store.update(tenant.id, {
      brand: { name: "Widget Pro", accent: "#0066ff" },
    });
    assert.equal(patched.brand?.name, "Widget Pro");
    assert.equal(patched.brand?.accent, "#0066ff");
    assert.equal(patched.brand?.supportAgentName, "Widget Bot");
  });

  it("defaults brand name from tenant name when omitted", async () => {
    const { tenant } = await store.create({ name: "Plain Tenant" });
    assert.equal(tenant.brand?.name, "Plain Tenant");
  });

  it("verifyIngestToken returns true for the tenant's own token", async () => {
    const { tenant, ingestToken } = await store.create({ name: "Token Co" });
    assert.equal(await store.verifyIngestToken(tenant.id, ingestToken), true);
  });

  it("verifyIngestToken returns false for a wrong token", async () => {
    const { tenant } = await store.create({ name: "Token Co" });
    assert.equal(await store.verifyIngestToken(tenant.id, "sk_live_wrong"), false);
  });

  it("verifyIngestToken returns false for an unknown tenant", async () => {
    const { ingestToken } = await store.create({ name: "Token Co" });
    assert.equal(
      await store.verifyIngestToken("00000000-0000-0000-0000-000000000000", ingestToken),
      false,
    );
  });
});
