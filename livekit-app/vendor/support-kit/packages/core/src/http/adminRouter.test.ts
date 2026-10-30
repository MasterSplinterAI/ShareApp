import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantIdSchema } from "@rhule/support-shared";
import { createMemorySqliteAdapter } from "../db/memorySqlite.js";
import { createSupportRouter } from "../index.js";
import { createMockResponse } from "./createRouter.js";

const tenantId = TenantIdSchema.parse("legalai");
const brand = {
  name: "TestApp",
  supportAgentName: "Test Support",
  agentAuthorId: "test-ai",
};

describe("admin HTTP API", () => {
  it("GET /admin/tickets requires admin role", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "u1", role: "user" }),
    });

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/admin/tickets" }, res);
    const out = await done;

    assert.equal(out.statusCode, 403);
  });

  it("GET /admin/tickets lists tickets with counts for admin", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: () => ({ id: "ops-1", role: "admin" }),
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Need help" } },
      createRes.res,
    );
    await createRes.done;

    const { res, done } = createMockResponse();
    await router.handler({ method: "GET", url: "/admin/tickets" }, res);
    const out = await done;

    assert.equal(out.statusCode, 200);
    const body = out.body as {
      tickets: unknown[];
      counts: { open: number; pending_ops: number; pending_review_proposals: number };
    };
    assert.equal(body.tickets.length, 1);
    assert.equal(body.counts.pending_ops, 1);
    assert.ok(body.counts.pending_review_proposals >= 0);
  });

  it("POST /admin/tickets/:id/reply adds staff message and sets waiting_user", async () => {
    const db = createMemorySqliteAdapter();
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      resolveUser: (req) => {
        const url = String((req as { url?: string }).url ?? "");
        if (url.includes("/admin/")) {
          return { id: "ops-1", role: "admin" };
        }
        return { id: "u1", role: "user" };
      },
    });

    const createRes = createMockResponse();
    await router.handler(
      { method: "POST", url: "/tickets", body: { body: "Billing issue" } },
      createRes.res,
    );
    const created = await createRes.done;
    const ticketId = (created.body as { ticket: { id: string } }).ticket.id;

    const replyRes = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: `/admin/tickets/${ticketId}/reply`,
        body: { body: "We are looking into this." },
      },
      replyRes.res,
    );
    const replied = await replyRes.done;

    assert.equal(replied.statusCode, 200);
    const ticket = (replied.body as { ticket: { status: string } }).ticket;
    assert.equal(ticket.status, "waiting_user");
    assert.ok((replied.body as { message: { authorType: string } }).message.authorType === "staff");
  });

  it("POST /admin/proposals/:id/action approve sends draft reply", async () => {
    const db = createMemorySqliteAdapter();
    const mockLlm = {
      async complete() {
        return JSON.stringify({
          route: "propose_reply",
          kind: "support",
          topic: "how_to",
          confidence: 0.4,
          summary: "Export help",
          body: { draft_reply: "Use Settings → Export to download your data." },
        });
      },
    };
    const router = createSupportRouter({
      tenantId,
      db,
      brand,
      llm: mockLlm,
      resolveUser: (req) => {
        const url = String((req as { url?: string }).url ?? "");
        if (url.includes("/admin/")) {
          return { id: "ops-1", role: "admin" };
        }
        return { id: "u1", role: "user" };
      },
    });

    const chatRes = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: "/chat",
        body: { message: "How do I export my matters?" },
      },
      chatRes.res,
    );
    const chatOut = await chatRes.done;
    const ticketId = (chatOut.body as { ticket: { id: string } }).ticket.id;

    const detailRes = createMockResponse();
    await router.handler(
      { method: "GET", url: `/admin/tickets/${ticketId}` },
      detailRes.res,
    );
    const detail = await detailRes.done;
    const proposal = (detail.body as { proposals: { id: string; status: string }[] })
      .proposals[0]!;
    assert.equal(proposal.status, "pending_review");

    const actionRes = createMockResponse();
    await router.handler(
      {
        method: "POST",
        url: `/admin/proposals/${proposal.id}/action`,
        body: { action: "approve" },
      },
      actionRes.res,
    );
    const actionOut = await actionRes.done;

    assert.equal(actionOut.statusCode, 200);
    assert.equal(
      (actionOut.body as { proposal: { status: string } }).proposal.status,
      "approved",
    );
    assert.equal(
      (actionOut.body as { ticket: { status: string } }).ticket.status,
      "waiting_user",
    );
    assert.ok((actionOut.body as { message?: { body: string } }).message?.body);
  });
});
