import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, beforeEach } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import type { LlmAdapter } from "../adapters/types.js";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { clearDocsCache } from "../kb/search.js";
import { createSupportRouter } from "../index.js";
import { createMockResponse } from "./createRouter.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../kb/fixtures",
);

const tenantId = TenantIdSchema.parse("legalai");
const brand = { name: "TestApp", supportAgentName: "Test Support", agentAuthorId: "test-ai" };

function mockLlm(response: object): LlmAdapter {
  return {
    async complete() {
      return JSON.stringify(response);
    },
  };
}

describe("createSupportRouter HTTP API", () => {
  beforeEach(() => {
    clearDocsCache();
  });

  it("GET /health returns ok without auth", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/health" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { ok: boolean }).ok, true);
    assert.equal((out.body as { brand: string }).brand, "TestApp");
  });

  it("POST /chat requires auth", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => null,
    });

    const { res, done } = createMockResponse();
    await router.handler(
      { method: "POST", url: "/chat", body: { message: "hello" } },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 401);
  });

  it("POST /chat runs agent triage (always creates ticket)", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      docsRoot: fixturesDir,
      llm: mockLlm({
        route: "reply_in_app",
        kind: "support",
        topic: "how_to",
        confidence: 0.9,
        summary: "Upload help",
        body: { draft_reply: "Open Documents and click Upload." },
      }),
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/chat",
        body: { message: "How do I upload a document?" },
      },
      res,
    );
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { action: string }).action, "ticket");
    assert.equal((out.body as { autoReplied: boolean }).autoReplied, true);
    assert.ok((out.body as { ticket: { publicNumber: number } }).ticket.publicNumber);
  });

  it("GET /tickets lists user tickets", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Need help" } },
      createRes.res,
    );
    await createRes.done;

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/tickets" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    const tickets = (out.body as { tickets: unknown[] }).tickets;
    assert.equal(tickets.length, 1);
  });

  it("GET /tickets/:id returns ticket and messages", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Ticket body" } },
      createRes.res,
    );
    const created = await createRes.done;
    const ticketId = (created.body as { ticket: { id: string } }).ticket.id;

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: `/tickets/${ticketId}` }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    assert.equal((out.body as { ticket: { id: string } }).ticket.id, ticketId);
    assert.equal((out.body as { messages: unknown[] }).messages.length, 1);
  });

  it("returns 404 for unknown routes", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/unknown" }, res);
    const out = await done;

    assert.equal(out.statusCode, 404);
  });
});
