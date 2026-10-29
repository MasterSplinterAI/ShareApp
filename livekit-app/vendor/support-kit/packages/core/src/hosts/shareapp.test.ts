import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHostSqliteDbAdapter,
  mapV2AuthToSupportUser,
} from "./shareapp.js";

describe("ShareApp host mapping", () => {
  it("maps req.v2Auth onto SupportUser and returns null when logged out", () => {
    const user = mapV2AuthToSupportUser({
      userId: "u1",
      email: "host@example.com",
      orgId: "org-9",
      role: "admin",
    });
    assert.deepEqual(user, {
      id: "u1",
      email: "host@example.com",
      orgId: "org-9",
      role: "admin",
    });
    assert.equal(mapV2AuthToSupportUser(undefined), null);
    assert.equal(mapV2AuthToSupportUser(null), null);
  });

  it("wraps a host sqlite run/get/all handle as DbAdapter", async () => {
    const calls: string[] = [];
    const host = {
      run: async (sql: string, params: unknown[] = []) => {
        calls.push(`run:${sql}:${params.join(",")}`);
        return { lastID: 1, changes: 1 };
      },
      get: async (sql: string, params: unknown[] = []) => {
        calls.push(`get:${sql}:${params.join(",")}`);
        return { id: "row" };
      },
      all: async (sql: string, params: unknown[] = []) => {
        calls.push(`all:${sql}:${params.join(",")}`);
        return [{ id: "row" }];
      },
    };

    const db = createHostSqliteDbAdapter(host);
    const run = await db.run("INSERT INTO t (id) VALUES (?)", ["x"]);
    const row = await db.get("SELECT id FROM t WHERE id = ?", ["x"]);
    const rows = await db.all("SELECT id FROM t");

    assert.equal(run.changes, 1);
    assert.deepEqual(row, { id: "row" });
    assert.equal(rows.length, 1);
    assert.ok(calls[0]?.startsWith("run:"));
    assert.ok(calls[1]?.startsWith("get:"));
    assert.ok(calls[2]?.startsWith("all:"));
  });
});
