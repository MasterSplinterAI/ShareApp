import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { ensureSchema } from "../db/migrate.js";
import { searchActiveArticles } from "./search.js";
import { seedCuratedDocs } from "./seedCuratedDocs.js";

describe("seedCuratedDocs", () => {
  it("crawls markdown, curates drafts, and promotes them to active", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "support-kit-kb-"));
    fs.writeFileSync(
      path.join(dir, "reset.md"),
      "# Reset password\n\nUse the forgot-password link on the login page.\n",
    );

    const db = createMemorySqliteAdapter();
    await ensureSchema(db);
    const result = await seedCuratedDocs(db, "demo", dir);

    assert.equal(result.ingested, 1);
    assert.equal(result.promoted, 1);
    assert.equal(result.tenantId, "demo");

    const hits = await searchActiveArticles(db, "demo", { query: "forgot password" });
    assert.ok(hits.length >= 1);
    assert.match(hits[0]?.title ?? "", /reset/i);
  });
});
