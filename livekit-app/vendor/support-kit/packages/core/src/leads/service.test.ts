import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { LeadService } from "./service.js";

describe("LeadService", () => {
  it("upserts lead and sets SMS opt-in only when phone + marketing", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const leads = new LeadService(db);
    const tenantId = TenantIdSchema.parse("dev");

    const a = await leads.upsertLead({
      tenantId,
      name: "Alex",
      email: "Alex@Example.com",
      marketingOptIn: true,
      source: "public_launcher",
      consentText: "I agree…",
    });
    assert.equal(a.email, "alex@example.com");
    assert.equal(a.marketingEmailOptIn, true);
    assert.equal(a.marketingSmsOptIn, false);

    const b = await leads.upsertLead({
      tenantId,
      name: "Alex R",
      email: "alex@example.com",
      phone: "+1 555 0100",
      marketingOptIn: true,
      source: "public_launcher",
      consentText: "I agree…",
    });
    assert.equal(b.id, a.id);
    assert.equal(b.name, "Alex R");
    assert.equal(b.phone, "+1 555 0100");
    assert.equal(b.marketingSmsOptIn, true);

    const listed = await leads.list(tenantId, { marketingOnly: true });
    assert.equal(listed.length, 1);
  });

  it("requires valid email via schema", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const leads = new LeadService(db);
    await assert.rejects(
      () =>
        leads.upsertLead({
          tenantId: TenantIdSchema.parse("dev"),
          name: "X",
          email: "not-an-email",
          marketingOptIn: false,
        }),
    );
  });
});
