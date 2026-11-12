import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { searchActiveArticles } from "../kb/search.js";
import { createSupportRouter } from "../index.js";
import { createMockResponse } from "../http/createRouter.js";
import { resolveTenantFromStore } from "./resolveFromStore.js";
import { TenantStore } from "./store.js";

const defaultBrand = {
  name: "Platform Default",
  supportAgentName: "Default Support",
  agentAuthorId: "default-ai",
};

describe("tenant KB isolation integration", () => {
  let db: ReturnType<typeof createMemorySqliteAdapter>;
  let tenantStore: TenantStore;

  beforeEach(async () => {
    db = createMemorySqliteAdapter();
    await ensureSchema(db);
    tenantStore = new TenantStore(db);
  });

  it("create tenant → ingest → promote → searchActiveArticles hits that tenant only", async () => {
    const { tenant } = await tenantStore.create({
      name: "Isolated Co",
      brand: { name: "Isolated Co" },
    });

    const router = createSupportRouter({
      tenantId: "demo",
      db,
      brand: defaultBrand,
      resolveUser: () => ({ id: "admin1", role: "admin" }),
      resolveTenant: resolveTenantFromStore(tenantStore),
      llm: {
        async complete() {
          return JSON.stringify({
            title: "Tenant-only FAQ",
            body: "Isolated Co answers billing questions here.",
          });
        },
      },
      kbIngest: { webhookSecret: "s3cret" },
    });

    const { res: ingestRes, done: ingestDone } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/admin/kb/ingest/uploads",
        body: {
          docs: [{ name: "faq.txt", content: "Billing FAQ for Isolated Co only." }],
        },
        headers: {
          "x-tenant-id": tenant.id,
          "x-support-ingest-token": "s3cret",
        },
      },
      ingestRes,
    );
    const ingestOut = await ingestDone;
    assert.equal(ingestOut.statusCode, 200);
    const articleId = (ingestOut.body as { articles: Array<{ id: string }> }).articles[0]!.id;

    const { res: promoteRes, done: promoteDone } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: `/admin/kb/${articleId}/promote`,
        headers: { "x-tenant-id": tenant.id },
      },
      promoteRes,
    );
    const promoteOut = await promoteDone;
    assert.equal(promoteOut.statusCode, 200);

    const tenantHits = await searchActiveArticles(db, tenant.id, {
      query: "billing isolated",
    });
    assert.ok(tenantHits.some((h) => h.title.includes("Tenant-only FAQ")));

    const demoHits = await searchActiveArticles(db, "demo", {
      query: "billing isolated",
    });
    assert.equal(demoHits.length, 0);
  });
});
