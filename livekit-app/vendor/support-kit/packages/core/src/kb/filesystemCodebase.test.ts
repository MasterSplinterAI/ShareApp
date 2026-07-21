import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFilesystemCodebaseAdapter } from "./filesystemCodebase.js";

describe("createFilesystemCodebaseAdapter", () => {
  it("searches allowlisted dirs and reads files", async () => {
    const root = mkdtempSync(join(tmpdir(), "support-cb-"));
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "server"));
    writeFileSync(
      join(root, "docs", "billing.md"),
      "# Billing\nUsers can change plans on the billing page. AI ceiling is monthly.",
    );
    writeFileSync(
      join(root, "server", "stripe.ts"),
      'export const PLANS = { free: { aiCeilingUsd: 2 }, solo: { aiCeilingUsd: 15 } };',
    );
    writeFileSync(join(root, "secret.env"), "SECRET=nope");

    const cb = createFilesystemCodebaseAdapter({
      root,
      label: "TestApp",
      allowlist: ["docs", "server"],
    });

    const hits = await cb.search("billing AI ceiling plans");
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.path.includes("billing.md") || h.path.includes("stripe.ts")));

    const body = await cb.readFile("docs/billing.md");
    assert.match(String(body), /Billing/);

    const denied = await cb.readFile("secret.env");
    assert.equal(denied, null);
  });
});
