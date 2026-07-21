import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import {
  clearDocsCache,
  searchActiveArticles,
  searchCuratedDocs,
} from "./search.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("searchCuratedDocs", () => {
  beforeEach(() => {
    clearDocsCache();
  });

  it("returns ranked hits for a billing refund query", () => {
    const hits = searchCuratedDocs("billing refund request", {
      docsRoot: fixturesDir,
      limit: 5,
    });

    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.source, "billing.md");
    assert.ok(hits[0]!.score > 0);
    assert.match(hits[0]!.title, /refund/i);

    if (hits.length > 1) {
      assert.ok(hits[0]!.score >= hits[1]!.score);
    }
  });

  it("prefers faq fallback when query has no matches", () => {
    const hits = searchCuratedDocs("zzzznonexistent", {
      docsRoot: fixturesDir,
      limit: 3,
      fallbackSources: ["faq.md"],
    });

    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.source, "faq.md");
    assert.equal(hits[0]?.score, 0);
  });
});

describe("searchActiveArticles", () => {
  it("returns only active kb_articles for the tenant", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");
    const otherTenant = TenantIdSchema.parse("shareapp");
    const now = new Date().toISOString();

    const insert = async (
      tid: string,
      title: string,
      status: string,
      sourceKind: string,
    ) => {
      const id = randomUUID();
      await db.run(
        `INSERT INTO support_kb_articles (
          id, tenant_id, title, body, status, source_kind, source_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          tid,
          title,
          `${title} body with billing refund keywords`,
          status,
          sourceKind,
          `${sourceKind}-${title}`,
          now,
          now,
        ],
      );
      return id;
    };

    await insert(tenantId, "Active curated", "active", "curated");
    await insert(tenantId, "Draft codegen", "draft", "codegen");
    await insert(tenantId, "Draft evolutionary", "draft", "evolutionary");
    await insert(otherTenant, "Other tenant active", "active", "curated");

    const active = await searchActiveArticles(db, tenantId);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.title, "Active curated");
    assert.equal(active[0]?.status, "active");

    const ranked = await searchActiveArticles(db, tenantId, { query: "billing refund" });
    assert.equal(ranked.length, 1);
    assert.match(ranked[0]?.body ?? "", /billing refund/i);
  });
});
