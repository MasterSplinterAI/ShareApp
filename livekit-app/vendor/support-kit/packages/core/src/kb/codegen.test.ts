import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { searchActiveArticles } from "./search.js";
import {
  ingestCodegenArticle,
  ingestFromChangelog,
  promoteKbArticle,
} from "./codegen.js";

describe("codegen KB ingestion", () => {
  it("excludes draft from searchActiveArticles until promoted", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const draft = await ingestCodegenArticle(db, {
      tenantId,
      title: "Deploy notes",
      body: "New billing refund flow deployed",
      sourceKey: "docs/deploy-notes.md",
      gitSha: "abc123",
      path: "docs/deploy-notes.md",
    });

    assert.equal(draft.status, "draft");
    assert.equal(draft.sourceKind, "codegen");

    const beforePromote = await searchActiveArticles(db, tenantId, {
      query: "billing refund",
    });
    assert.equal(beforePromote.length, 0);

    const active = await promoteKbArticle(db, tenantId, draft.id);
    assert.equal(active.status, "active");

    const afterPromote = await searchActiveArticles(db, tenantId, {
      query: "billing refund",
    });
    assert.equal(afterPromote.length, 1);
    assert.equal(afterPromote[0]?.id, draft.id);
    assert.equal(afterPromote[0]?.title, "Deploy notes");
  });

  it("upserts by tenant_id + source_kind + source_key", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const first = await ingestCodegenArticle(db, {
      tenantId,
      title: "v1",
      body: "first body",
      sourceKey: "changelog:release-1",
    });

    const second = await ingestCodegenArticle(db, {
      tenantId,
      title: "v2",
      body: "updated body with billing refund",
      sourceKey: "changelog:release-1",
      gitSha: "def456",
    });

    assert.equal(second.id, first.id);
    assert.equal(second.title, "v2");
    assert.equal(second.body, "updated body with billing refund");
    assert.equal(second.status, "draft");

    const rows = await db.all(
      `SELECT id FROM support_kb_articles WHERE tenant_id = ? AND source_key = ?`,
      [tenantId, "changelog:release-1"],
    );
    assert.equal(rows.length, 1);
  });

  it("ingestFromChangelog splits ## sections into draft articles", async () => {
    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const tenantId = TenantIdSchema.parse("legalai");

    const changelog = `# Changelog

## Billing improvements
Added refund workflow.

## Login fixes
Fixed crash on startup.
`;

    const articles = await ingestFromChangelog(db, tenantId, changelog, {
      gitSha: "sha1",
    });

    assert.equal(articles.length, 2);
    assert.equal(articles[0]?.sourceKey, "changelog:billing-improvements");
    assert.equal(articles[1]?.sourceKey, "changelog:login-fixes");
    assert.equal(articles.every((a) => a.status === "draft"), true);

    const active = await searchActiveArticles(db, tenantId);
    assert.equal(active.length, 0);
  });
});
